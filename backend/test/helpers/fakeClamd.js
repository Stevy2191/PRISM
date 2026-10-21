// Minimal fake clamd for tests. Speaks just enough of the protocol:
// zINSTREAM\0 + (uint32-BE length + bytes)* + 4 zero bytes, and zVERSION\0.
// Modes: ok | found | error | sizeLimit | hang | split | garbage
const net = require('net');

const EICAR_SIG = 'Eicar-Test-Signature';

function startFakeClamd({ mode = 'ok', signature = EICAR_SIG, version = 'ClamAV 1.5.4/28150/Sun Oct 11 06:26:01 2026', delayMs = 0 } = {}) {
  const received = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    let buf = Buffer.alloc(0);
    let command = null;
    let streamDone = false;
    sock.on('data', (d) => {
      if (streamDone) return;
      buf = Buffer.concat([buf, d]);
      if (!command) {
        const nul = buf.indexOf(0);
        if (nul === -1) return;
        command = buf.subarray(0, nul).toString();
        buf = buf.subarray(nul + 1);
        if (command === 'zVERSION') {
          streamDone = true;
          return reply(sock, mode === 'garbage' ? 'what?' : version);
        }
        if (command !== 'zINSTREAM') { streamDone = true; return reply(sock, 'UNKNOWN COMMAND. ERROR'); }
      }
      // Parse chunk frames.
      for (;;) {
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          received.push(Buffer.alloc(4));
          buf = buf.subarray(4);
          streamDone = true;
          return verdict(sock);
        }
        if (buf.length < 4 + len) return;
        received.push(Buffer.from(buf.subarray(0, 4 + len)));
        buf = buf.subarray(4 + len);
        if (mode === 'sizeLimit') {
          sock.end('INSTREAM size limit exceeded. ERROR\0');
          setTimeout(() => sock.destroy(), 5);
          streamDone = true;
          return;
        }
      }
    });
  });

  function reply(sock, text) {
    setTimeout(() => sock.end(`${text}\0`), delayMs);
  }
  function verdict(sock) {
    if (mode === 'hang') return; // never answers
    if (mode === 'found') return reply(sock, `stream: ${signature} FOUND`);
    if (mode === 'error') return reply(sock, 'INSTREAM size limit exceeded. ERROR');
    if (mode === 'garbage') return reply(sock, 'banana');
    if (mode === 'split') {
      sock.write('stream: Eicar-Test-');
      return setTimeout(() => sock.end('Signature FOUND\0'), 30);
    }
    return reply(sock, 'stream: OK');
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { startFakeClamd, EICAR_SIG };
