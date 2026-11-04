// Device authentication for the PRISM agent's API (8a). Every request after
// enrolment is signed with the device's Ed25519 key over
//
//   METHOD \n path?query \n timestamp \n nonce \n sha256(body) as hex
//
// sent as X-Prism-Device (device id), X-Prism-Timestamp (unix seconds),
// X-Prism-Nonce and X-Prism-Signature (base64). Refused, all with the same
// 401: an unknown or revoked device, a timestamp more than 5 minutes off, a
// bad signature, or a nonce the device has used before. The nonce is recorded
// only after the signature verifies, so nobody else can fill the table.
// No session is read: agents have none.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Device, AgentNonce } = require('../models');
const { ApiError } = require('./error');

const MAX_SKEW_SEC = 5 * 60;
const NONCE_TTL_MS = 10 * 60 * 1000;
// Most agent requests are small; an inventory's software list can be long,
// so its route allows more (agentAuth({ maxBody })).
const MAX_BODY_BYTES = 256 * 1024;
const NONCE_RE = /^[A-Za-z0-9_-]{16,32}$/;
// DER prefix that turns a raw 32-byte Ed25519 key into SPKI.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const refused = () => new ApiError(401, 'This device is not recognised', 'AGENT_UNAUTHORIZED');
const sha256hex = (buf) => crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex');

function canonicalString(method, pathQuery, timestamp, nonce, body) {
  return `${method.toUpperCase()}\n${pathQuery}\n${timestamp}\n${nonce}\n${sha256hex(body)}`;
}

function publicKeyObject(rawB64) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(rawB64, 'base64')]), format: 'der', type: 'spki' });
}

function verifySignature(rawB64, canonical, signatureB64) {
  try {
    const sig = Buffer.from(signatureB64, 'base64');
    if (sig.length !== 64) return false;
    return crypto.verify(null, Buffer.from(canonical), publicKeyObject(rawB64), sig);
  } catch {
    return false;
  }
}

let lastPrune = 0;
async function pruneNonces(now) {
  if (now - lastPrune < 60 * 1000) return;
  lastPrune = now;
  await AgentNonce.destroy({ where: { seenAt: { [Op.lt]: new Date(now - NONCE_TTL_MS) } } });
}

function agentAuth({ maxBody = MAX_BODY_BYTES } = {}) {
  return async function agentAuthenticate(req, res, next) {
    try {
      const id = Number(req.get('X-Prism-Device'));
      const ts = req.get('X-Prism-Timestamp') || '';
      const nonce = req.get('X-Prism-Nonce') || '';
      const signature = req.get('X-Prism-Signature') || '';
      if (!Number.isInteger(id) || id <= 0 || !/^\d{1,12}$/.test(ts) || !NONCE_RE.test(nonce) || !signature) throw refused();
      const now = Date.now();
      if (Math.abs(now / 1000 - Number(ts)) > MAX_SKEW_SEC) throw refused();
      // The signature covers the raw JSON body. A body sent as anything
      // else (a form, say) was parsed without being kept, so it could never
      // be checked: refuse it rather than check an empty one.
      const sent = Number(req.get('content-length') || 0) > 0 || !!req.get('transfer-encoding');
      if (sent && !req.rawBody) throw refused();
      const body = req.rawBody || Buffer.alloc(0);
      if (body.length > maxBody) throw new ApiError(413, 'Too much data in one request', 'PAYLOAD_TOO_LARGE');

      const device = await Device.findByPk(id);
      if (!device || device.revokedAt) throw refused();
      if (!verifySignature(device.publicKey, canonicalString(req.method, req.originalUrl, ts, nonce, body), signature)) throw refused();
      try {
        await AgentNonce.create({ deviceId: device.id, nonce, seenAt: new Date(now) });
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') throw refused();
        throw err;
      }
      pruneNonces(now).catch(() => {});
      req.device = device;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

const agentAuthenticate = agentAuth();

module.exports = {
  agentAuth, agentAuthenticate, canonicalString, verifySignature, publicKeyObject, MAX_BODY_BYTES,
};
