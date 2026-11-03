// Signs agent requests the way the Go agent does (8a, middleware/agentAuth),
// for the agent suites. Also builds the shared signing vector check.
const crypto = require('crypto');
const request = require('supertest');

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// An Ed25519 key pair; from a 32-byte seed when given (deterministic).
function makeKeys(seedHex) {
  const privateKey = seedHex
    ? crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' })
    : crypto.generateKeyPairSync('ed25519').privateKey;
  const publicKeyB64 = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  return { privateKey, publicKeyB64 };
}

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const canonical = (method, pathQuery, ts, nonce, bodyBuf) => `${method}\n${pathQuery}\n${ts}\n${nonce}\n${sha256hex(bodyBuf)}`;
const sign = (privateKey, text) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64');

// A signed client for one enrolled device.
function agentClient(app, deviceId, keys) {
  return {
    deviceId,
    keys,
    // opts: { ts, nonce, body (raw string), deviceId, signWith, tamper }
    send(method, path, payload, opts = {}) {
      const raw = opts.body !== undefined ? opts.body : (payload === undefined ? '' : JSON.stringify(payload));
      const ts = String(opts.ts !== undefined ? opts.ts : Math.floor(Date.now() / 1000));
      const nonce = opts.nonce || crypto.randomBytes(12).toString('base64url');
      const sig = sign((opts.signWith || keys).privateKey, canonical(method, path, ts, nonce, Buffer.from(raw)));
      let req = request(app)[method.toLowerCase()](path)
        .set('X-Prism-Device', String(opts.deviceId || deviceId))
        .set('X-Prism-Timestamp', ts)
        .set('X-Prism-Nonce', nonce)
        .set('X-Prism-Signature', sig);
      if (raw !== '') req = req.set('Content-Type', 'application/json').send(opts.tamper ? opts.tamper(raw) : raw);
      return req;
    },
    post(path, payload, opts) { return this.send('POST', path, payload, opts); },
    get(path, opts) { return this.send('GET', path, undefined, opts); },
  };
}

// Enrols a new device with an enrolment secret and returns its client.
async function enrollDevice(app, secret, extra = {}) {
  const keys = makeKeys();
  const res = await request(app).post('/api/v1/agent/v1/enroll').send({
    enrollKey: secret, publicKey: keys.publicKeyB64, platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'RFC-FD-01', ...extra,
  });
  if (res.status !== 201) throw new Error(`enroll: ${res.status} ${JSON.stringify(res.body)}`);
  return agentClient(app, res.body.deviceId, keys);
}

module.exports = {
  makeKeys, canonical, sign, sha256hex, agentClient, enrollDevice,
};
