// API keys: making them and checking them.
//
// A key is "prism_" + 32 random bytes in hex. It is stored only as the
// SHA-256 of the whole key (lookupHash) and found by that hash directly. A
// fast hash is right here: bcrypt's cost protects passwords people choose and
// can be guessed, while 256 random bits can't be, and bcrypt held the event
// loop ~0.37 s per request, stalling every other user while a script ran.
//
// Keys made before migration 099 have only a bcrypt hash (keyHash). They are
// found the old way, by their 8-character prefix and a bcrypt compare, and
// moved to lookupHash on that first successful use, so each pays the bcrypt
// cost once.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

const KEY_RE = /^prism_[0-9a-f]{64}$/;
// lastUsed is written at most this often per key, not on every request.
const LAST_USED_EVERY_MS = 60_000;

const lookupHashOf = (plaintext) => crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');

function models() {
  // Required lazily: models/index requires this module's callers.
  // eslint-disable-next-line global-require
  return require('../models');
}

function newApiKey() {
  const plaintext = `prism_${crypto.randomBytes(32).toString('hex')}`;
  return {
    plaintext,
    // 8 hex chars after the "prism_" tag: shown in listings so people can tell
    // their keys apart. Not secret enough to matter, not used to check.
    prefix: plaintext.slice(6, 14),
    lookupHash: lookupHashOf(plaintext),
  };
}

const notExpired = () => ({ [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] });

async function touch(apiKey, changes = {}) {
  const now = new Date();
  const stale = !apiKey.lastUsed || now - apiKey.lastUsed >= LAST_USED_EVERY_MS;
  const update = stale ? { ...changes, lastUsed: now } : changes;
  if (Object.keys(update).length) await apiKey.update(update);
}

// A key made before 099: prefix candidates without a lookupHash, bcrypt.
async function findLegacy(plaintext, include) {
  const { ApiKey } = models();
  const candidates = await ApiKey.findAll({
    where: { prefix: plaintext.slice(6, 14), lookupHash: null, keyHash: { [Op.ne]: null }, [Op.and]: [notExpired()] },
    include,
  });
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(plaintext, candidate.keyHash)) return candidate;
  }
  return null;
}

// The active user a key belongs to, or null. `include` loads the user (and
// whatever the caller needs on it) with the key.
async function resolveApiKey(plaintext, { userInclude = [] } = {}) {
  if (typeof plaintext !== 'string' || !KEY_RE.test(plaintext)) return null;
  const { ApiKey, User } = models();
  const include = [{ model: User, as: 'user', include: userInclude }];
  const lookupHash = lookupHashOf(plaintext);

  let apiKey = await ApiKey.findOne({ where: { lookupHash, [Op.and]: [notExpired()] }, include });
  let upgrade = {};
  if (!apiKey) {
    apiKey = await findLegacy(plaintext, include);
    if (apiKey) upgrade = { lookupHash, keyHash: null };
  }
  if (!apiKey || !apiKey.user || !apiKey.user.isActive) return null;
  await touch(apiKey, upgrade);
  return apiKey.user;
}

module.exports = {
  newApiKey, resolveApiKey, lookupHashOf, LAST_USED_EVERY_MS,
};
