// ClamAV (clamd) client. Speaks the INSTREAM protocol over plain TCP using
// only Node's `net`/`fs` — no dependency. Fail closed: anything other than
// "stream: OK" / "stream: <sig> FOUND" is treated as "scanner unavailable".
// Config is read from process.env on every call so tests can switch it.
const net = require('net');
const fs = require('fs');
const { ApiError } = require('../middleware/error');

const CHUNK = 64 * 1024;
const UNAVAILABLE_MESSAGE =
  "Files can't be uploaded right now: the virus scanner isn't reachable. Try again later or contact your administrator.";

let timeouts = { connectMs: 3000, scanMs: 60000 };
function _setTimeoutsForTest(t = {}) {
  timeouts = { connectMs: 3000, scanMs: 60000, ...t };
}

// An ApiError so the central handler keeps the message on a 5xx instead of
// replacing it with "Internal server error".
class ScannerUnavailableError extends ApiError {
  constructor(cause) {
    super(503, UNAVAILABLE_MESSAGE, 'SCANNER_UNAVAILABLE');
    this.name = 'ScannerUnavailableError';
    if (cause) this.cause = cause;
  }
}

function isEnabled() {
  return process.env.CLAMAV_ENABLED !== 'false';
}

function config() {
  return {
    host: process.env.CLAMAV_HOST || 'clamav',
    port: parseInt(process.env.CLAMAV_PORT, 10) || 3310,
  };
}

// Opens a connection and runs `send(sock)` (which writes the request), then
// resolves with the full reply text (read until NUL or the server closing).
// Every failure path — connect error, timeout, write EPIPE/ECONNRESET after
// clamd hangs up on a size limit — rejects; the 'error' listener is attached
// before anything is written so a socket error can never go unhandled.
function exchange(send) {
  const { host, port } = config();
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let settled = false;
    const chunks = [];
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(scanTimer);
      sock.destroy();
      if (err) reject(err); else resolve(value);
    };
    const reply = () => Buffer.concat(chunks).toString('utf8');
    const connectTimer = setTimeout(() => finish(new Error('connect timeout')), timeouts.connectMs);
    const scanTimer = setTimeout(() => finish(new Error('scan timeout')), timeouts.scanMs);
    sock.on('error', (e) => finish(e));
    sock.on('data', (d) => {
      chunks.push(d);
      if (d.includes(0)) finish(null, reply());
    });
    // Every reply is NUL-terminated (z-commands); one that just stops is cut
    // short and must not be read as a verdict.
    const ended = () => finish(reply().includes('\0') ? null : new Error('incomplete clamd reply'), reply());
    sock.on('end', ended);
    sock.on('close', ended);
    sock.once('connect', () => {
      clearTimeout(connectTimer);
      Promise.resolve(send(sock)).catch((e) => finish(e));
    });
  });
}

function writeChunk(sock, buf) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(buf.length, 0);
  sock.write(head);
  return sock.write(buf);
}

async function pump(sock, source) {
  sock.write('zINSTREAM\0');
  for await (const buf of source) {
    if (sock.destroyed) throw new Error('socket closed during upload');
    if (!writeChunk(sock, buf)) {
      // A destroyed socket never emits 'drain' or 'error', so wait for either
      // drain or close — otherwise this (and the open file) would hang forever.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const done = () => { sock.off('drain', done); sock.off('close', done); resolve(); };
        sock.once('drain', done);
        sock.once('close', done);
      });
    }
  }
  sock.write(Buffer.alloc(4));
}

async function* bufferChunks(buf) {
  for (let i = 0; i < buf.length; i += CHUNK) yield buf.subarray(i, i + CHUNK);
}

function parseVerdict(text) {
  const t = text.replace(/\0/g, '').trim();
  if (t === 'stream: OK') return { clean: true };
  const m = /^stream: (.+) FOUND$/.exec(t);
  if (m) {
    // eslint-disable-next-line no-control-regex
    const signature = m[1].replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
    return { clean: false, signature };
  }
  throw new Error(`unexpected clamd reply: ${t.slice(0, 120)}`);
}

async function scan(source) {
  if (!isEnabled()) return { clean: true };
  try {
    return parseVerdict(await exchange((sock) => pump(sock, source)));
  } catch (e) {
    // Release the file (or buffer) now, not whenever the pump notices.
    if (typeof source.destroy === 'function') source.destroy();
    if (typeof source.return === 'function') source.return().catch(() => {});
    console.error(`[virus-scan] scan failed: ${e.message}`);
    throw new ScannerUnavailableError(e);
  }
}

function scanFile(filePath) {
  return scan(fs.createReadStream(filePath, { highWaterMark: CHUNK }));
}

function scanBuffer(buf) {
  return scan(bufferChunks(buf));
}

// "ClamAV 1.5.4/28150/Sun Oct 11 06:26:01 2026" → { version, signatureDate }.
async function getStatus() {
  const none = { version: null, signatureDate: null };
  if (!isEnabled()) return { state: 'off', ...none };
  try {
    const text = (await exchange((sock) => sock.write('zVERSION\0'))).replace(/\0/g, '').trim();
    const m = /^(ClamAV [^/]+)(?:\/\d+\/(.+))?$/.exec(text);
    if (!m) throw new Error('unexpected VERSION reply');
    const d = m[2] ? new Date(m[2]) : null;
    return { state: 'ok', version: m[1], signatureDate: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null };
  } catch (e) {
    console.error(`[virus-scan] status check failed: ${e.message}`);
    return { state: 'unreachable', ...none };
  }
}

// ---- Admin alerts -------------------------------------------------------
const UNAVAILABLE_NOTICE_INTERVAL_MS = 60 * 60 * 1000;
let lastUnavailableNoticeAt = 0;
function _resetThrottleForTest() { lastUnavailableNoticeAt = 0; }

// Sender-controlled text (a filename, a From address) goes into an alert
// admins trust: no control characters, no double quotes to break out of the
// quoted name, and a length cap.
// eslint-disable-next-line no-control-regex
const plain = (v, max) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/"/g, "'").slice(0, max);

async function notifyVirusBlocked({ place, filename, signature, who }) {
  const { notifySecurityAdmins } = require('./notifications'); // eslint-disable-line global-require
  await notifySecurityAdmins({
    type: 'virus_blocked',
    message: `Virus blocked: "${plain(filename, 120)}" (${plain(signature, 100)}) uploaded by ${plain(who, 80)} to ${plain(place, 120)}`,
  });
}

// At most one "scanner unavailable" notice per hour per process, so an outage
// during a busy period doesn't flood admins.
async function notifyScannerUnavailable() {
  const now = Date.now();
  if (lastUnavailableNoticeAt && now - lastUnavailableNoticeAt < UNAVAILABLE_NOTICE_INTERVAL_MS) return;
  lastUnavailableNoticeAt = now;
  const { notifySecurityAdmins } = require('./notifications'); // eslint-disable-line global-require
  await notifySecurityAdmins({
    type: 'scanner_unavailable',
    message: "The virus scanner isn't reachable, so file uploads are being refused. Check the ClamAV service.",
  });
}

module.exports = {
  notifyVirusBlocked, notifyScannerUnavailable, _resetThrottleForTest, isEnabled, scanFile, scanBuffer, getStatus, ScannerUnavailableError, _setTimeoutsForTest };
