const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { startFakeClamd } = require('../helpers/fakeClamd');
const vs = require('../../src/services/virusScan');

let tmp;
let fake;
const write = (name, data) => { const p = path.join(tmp, name); fs.writeFileSync(p, data); return p; };

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-')); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  delete process.env.CLAMAV_ENABLED;
  delete process.env.CLAMAV_HOST;
  vs._setTimeoutsForTest({});
  jest.restoreAllMocks();
});

async function start(opts) {
  fake = await startFakeClamd(opts);
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(fake.port);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  return fake;
}

describe('scanFile', () => {
  it('clean file → {clean:true}', async () => {
    await start({ mode: 'ok' });
    expect(await vs.scanFile(write('a.txt', 'hello'))).toEqual({ clean: true });
  });

  it('EICAR reply → infected with signature', async () => {
    await start({ mode: 'found' });
    expect(await vs.scanFile(write('e.txt', 'x'))).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
  });

  it('reply split over two writes is joined', async () => {
    await start({ mode: 'split' });
    expect(await vs.scanFile(write('s.txt', 'x'))).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
  });

  it('ERROR reply → ScannerUnavailableError', async () => {
    await start({ mode: 'error' });
    await expect(vs.scanFile(write('x.txt', 'x'))).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE', status: 503 });
  });

  it('server closes mid-stream (size limit) → unavailable, no unhandled error', async () => {
    await start({ mode: 'sizeLimit' });
    const unhandled = jest.fn();
    process.on('uncaughtException', unhandled);
    const big = write('big.bin', Buffer.alloc(8 * 1024 * 1024, 1));
    await expect(vs.scanFile(big)).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
    await new Promise((r) => setTimeout(r, 50));
    process.off('uncaughtException', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('connection refused → unavailable', async () => {
    const s = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => s.once('listening', r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(port);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(vs.scanFile(write('r.txt', 'x'))).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
  });

  it('hang beyond scan timeout → unavailable', async () => {
    await start({ mode: 'hang' });
    vs._setTimeoutsForTest({ scanMs: 150 });
    await expect(vs.scanFile(write('h.txt', 'x'))).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
  });

  it('garbage reply → unavailable', async () => {
    await start({ mode: 'garbage' });
    await expect(vs.scanFile(write('g.txt', 'x'))).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
  });

  it('zero-byte file → clean, terminator sent', async () => {
    await start({ mode: 'ok' });
    expect(await vs.scanFile(write('z.txt', ''))).toEqual({ clean: true });
    expect(fake.received).toEqual([Buffer.alloc(4)]);
  });

  it('framing: uint32-BE length-prefixed chunks, 4 zero bytes at the end', async () => {
    await start({ mode: 'ok' });
    const data = Buffer.alloc(150 * 1024, 7);
    await vs.scanFile(write('f.bin', data));
    const chunks = fake.received;
    const term = chunks.pop();
    expect(term.equals(Buffer.alloc(4))).toBe(true);
    let total = 0;
    for (const c of chunks) {
      expect(c.readUInt32BE(0)).toBe(c.length - 4);
      expect(c.length - 4).toBeLessThanOrEqual(65536);
      total += c.length - 4;
    }
    expect(total).toBe(data.length);
  });

  it('error message is the user copy and cause is kept', async () => {
    await start({ mode: 'error' });
    const err = await vs.scanFile(write('m.txt', 'x')).catch((e) => e);
    expect(err).toBeInstanceOf(vs.ScannerUnavailableError);
    expect(err.message).toMatch(/virus scanner isn't reachable/);
    expect(err.cause).toBeDefined();
  });
});

describe('scanBuffer', () => {
  it('uses the same framing and returns the verdict', async () => {
    await start({ mode: 'found' });
    const buf = Buffer.alloc(70000, 3);
    expect(await vs.scanBuffer(buf)).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
    const chunks = fake.received;
    expect(chunks.pop().equals(Buffer.alloc(4))).toBe(true);
    expect(chunks.reduce((n, c) => n + c.length - 4, 0)).toBe(70000);
    chunks.forEach((c) => expect(c.readUInt32BE(0)).toBe(c.length - 4));
  });
});

describe('disabled', () => {
  it('CLAMAV_ENABLED=false → clean without connecting', async () => {
    await start({ mode: 'found' });
    process.env.CLAMAV_ENABLED = 'false';
    expect(vs.isEnabled()).toBe(false);
    expect(await vs.scanFile(write('d.txt', 'x'))).toEqual({ clean: true });
    expect(await vs.scanBuffer(Buffer.from('x'))).toEqual({ clean: true });
    expect(fake.received).toHaveLength(0);
  });
  it('is enabled unless exactly "false"', () => {
    process.env.CLAMAV_ENABLED = 'FALSE ';
    expect(vs.isEnabled()).toBe(true);
    delete process.env.CLAMAV_ENABLED;
    expect(vs.isEnabled()).toBe(true);
  });
});

describe('getStatus', () => {
  it('ok parses version and signature date', async () => {
    await start({ mode: 'ok' });
    const st = await vs.getStatus();
    expect(st.state).toBe('ok');
    expect(st.version).toBe('ClamAV 1.5.4');
    expect(new Date(st.signatureDate).getTime()).toBe(Date.parse('Sun Oct 11 06:26:01 2026'));
  });
  it('unreachable', async () => {
    const s = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => s.once('listening', r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(port);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await vs.getStatus()).toEqual({ state: 'unreachable', version: null, signatureDate: null });
  });
  it('garbage reply → unreachable', async () => {
    await start({ mode: 'garbage' });
    expect((await vs.getStatus()).state).toBe('unreachable');
  });
  it('off', async () => {
    process.env.CLAMAV_ENABLED = 'false';
    expect(await vs.getStatus()).toEqual({ state: 'off', version: null, signatureDate: null });
  });
  it('never includes host or error text', async () => {
    await start({ mode: 'ok' });
    const ok = JSON.stringify(await vs.getStatus());
    process.env.CLAMAV_PORT = '1';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const bad = JSON.stringify(await vs.getStatus());
    for (const s of [ok, bad]) {
      expect(s).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|clamav:|3310/);
    }
  });
});
