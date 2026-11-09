const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 8d, task 2: install links and push scripts.

const API = '/api/v1';
let w;
let company;
let dist;
const saved = { dist: process.env.AGENT_DIST_DIR, url: process.env.PUBLIC_APP_URL };

const anon = () => request(getApp());
const binary = (req) => req.buffer(true).parse((r, cb) => {
  const chunks = [];
  r.on('data', (c) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
});
async function newKey(body = { name: 'Rollout' }) {
  const res = await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys`).send(body);
  if (res.status !== 201) throw new Error(`key: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
function publish(entries) {
  const manifest = entries.map(([platform, arch, format, file]) => {
    const bytes = Buffer.from(`${platform} ${arch} ${format}`);
    fs.writeFileSync(path.join(dist, file), bytes);
    return {
      platform, arch, format, version: '0.6.0', file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest));
}

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dist-'));
  process.env.AGENT_DIST_DIR = dist;
  process.env.PUBLIC_APP_URL = 'https://prism.example.com';
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  publish([
    ['windows', 'amd64', 'msi', 'prism-agent-0.6.0-windows-amd64.msi'],
    ['macos', 'arm64', 'pkg', 'prism-agent-0.6.0-macos.pkg'],
    ['macos', 'amd64', 'pkg', 'prism-agent-0.6.0-macos.pkg'],
    ['linux', 'amd64', 'deb', 'prism-agent-0.6.0-linux-amd64.deb'],
    ['linux', 'amd64', 'rpm', 'prism-agent-0.6.0-linux-amd64.rpm'],
  ]);
});
afterEach(() => fs.rmSync(dist, { recursive: true, force: true }));
afterAll(async () => {
  for (const [env, v] of [['AGENT_DIST_DIR', saved.dist], ['PUBLIC_APP_URL', saved.url]]) {
    if (v === undefined) delete process.env[env]; else process.env[env] = v;
  }
  await closeDb();
});

it('a working link names the company and what can be downloaded, nothing more', async () => {
  const { secret } = await newKey();
  const res = await anon().get(`${API}/install/${secret}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    company: { name: 'Riverside' },
    url: 'https://prism.example.com',
    windows: { version: '0.6.0', size: expect.any(Number) },
    macos: { version: '0.6.0', size: expect.any(Number) },
    linux: {
      deb: { amd64: { version: '0.6.0', size: expect.any(Number) }, arm64: null },
      rpm: { amd64: { version: '0.6.0', size: expect.any(Number) }, arm64: null },
      pacman: { amd64: null, arm64: null },
    },
  });
  expect(res.headers['cache-control']).toBe('no-store');
});

it('unknown, malformed, revoked, expired and used-up links all get the same answer', async () => {
  const revoked = await newKey({ name: 'Revoked' });
  await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys/${revoked.key.id}/revoke`);
  const expired = await newKey({ name: 'Expired' });
  await models.AgentEnrollmentKey.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: expired.key.id } });
  const usedUp = await newKey({ name: 'Used', maxUses: 1 });
  await models.AgentEnrollmentKey.update({ enrolledCount: 1 }, { where: { id: usedUp.key.id } });
  const rotated = await newKey({ name: 'Rotated' });
  await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys/${rotated.key.id}/rotate`);
  const inactive = await makeCompany(w.admin, { name: 'Gone' });
  const gone = (await w.admin.agent.post(`${API}/companies/${inactive.id}/agent-keys`).send({ name: 'G' })).body.secret;
  await models.Company.update({ status: 'inactive' }, { where: { id: inactive.id } });

  const unknown = `pk_enr_${'A'.repeat(43)}`;
  const bodies = new Set();
  for (const secret of [unknown, 'pk_enr_short', 'nonsense', revoked.secret, expired.secret, usedUp.secret, rotated.secret, gone]) {
    for (const suffix of ['', '/windows', '/mac', '/linux.sh', '/mac.sh', '/windows.ps1', '/linux/deb/amd64']) {
      const res = await anon().get(`${API}/install/${encodeURIComponent(secret)}${suffix}`); // eslint-disable-line no-await-in-loop
      expect(res.status).toBe(404);
      bodies.add(JSON.stringify(res.body));
    }
  }
  expect([...bodies]).toEqual([JSON.stringify({
    error: true, message: 'This install link no longer works. Ask your IT team for a new one.', code: 'INSTALL_LINK_INVALID',
  })]);
});

it('Windows and Mac installers come named so they enroll themselves; each download is logged', async () => {
  const { secret, key } = await newKey();
  const win = await binary(anon().get(`${API}/install/${secret}/windows`));
  expect(win.status).toBe(200);
  expect(win.headers['content-disposition']).toContain(`PRISM-Agent-Setup_prism.example.com_${secret}.msi`);
  expect(win.body.toString()).toBe('windows amd64 msi');
  const mac = await binary(anon().get(`${API}/install/${secret}/mac`));
  expect(mac.headers['content-disposition']).toContain(`PRISM-Agent-Setup_prism.example.com_${secret}.pkg`);
  expect(mac.body.toString()).toMatch(/^macos (arm64|amd64) pkg$/); // one universal file
  const rpm = await binary(anon().get(`${API}/install/${secret}/linux/rpm/amd64`));
  expect(rpm.body.toString()).toBe('linux amd64 rpm');
  expect((await anon().get(`${API}/install/${secret}/linux/pacman/amd64`)).status).toBe(404);
  expect((await anon().get(`${API}/install/${secret}/linux/msi/amd64`)).status).toBe(404);
  const logged = await models.AuditLog.findAll({ where: { action: 'agent.install_link_download' } });
  expect(logged).toHaveLength(3);
  expect(JSON.stringify(logged.map((l) => l.toJSON()))).not.toContain(secret);
  expect(logged.every((l) => JSON.stringify(l.toJSON()).includes(`"keyId":${key.id}`))).toBe(true);
});

it('a port in PRISM\'s address is written with + in the file name', async () => {
  process.env.PUBLIC_APP_URL = 'https://prism.example.com:8443/';
  const { secret } = await newKey();
  const win = await anon().get(`${API}/install/${secret}/windows`);
  expect(win.headers['content-disposition']).toContain(`PRISM-Agent-Setup_prism.example.com+8443_${secret}.msi`);
});

it('the scripts carry the address and key and install only over HTTPS', async () => {
  const { secret } = await newKey();
  const linux = await anon().get(`${API}/install/${secret}/linux.sh`);
  expect(linux.status).toBe(200);
  expect(linux.headers['content-type']).toMatch(/^text\/x-shellscript/);
  expect(linux.text).toContain("URL='https://prism.example.com'");
  expect(linux.text).toContain(`KEY='${secret}'`);
  expect(linux.text).toContain("--proto '=https'");
  expect(linux.text).toContain('prism-agent enroll --url "$URL" --key "$KEY"');
  const mac = await anon().get(`${API}/install/${secret}/mac.sh`);
  expect(mac.text).toContain('installer -pkg');
  expect(mac.text).toContain(`KEY='${secret}'`);
  const ps = await anon().get(`${API}/install/${secret}/windows.ps1`);
  expect(ps.text).toContain(`$Key = '${secret}'`);
  expect(ps.text).toContain("$Url = 'https://prism.example.com'");
  expect(ps.text).toContain("'/qn'");
  expect(ps.text).toContain('PRISM\\Agent\\prism-agent.exe');
});
