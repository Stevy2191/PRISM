// PRISM agent enrollment (8a). Staff create per-company enrollment keys; an
// install command carries one, and the agent trades it, with its own
// Ed25519 public key, for a device identity. Every later agent request is
// signed with that key (middleware/agentAuth).
//
// An enrollment only ever creates or claims Assets in its key's company: it
// claims an Asset there with the same serial number and no live device, or
// creates a new Asset in Computers.
const crypto = require('crypto');
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const {
  sequelize, AgentEnrollmentKey, Asset, AssetCategory, Device, Company,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { suggestNextAssetTag } = require('../assetTagService');
const { validFormat } = require('./updates');
const { encryptToken, decryptToken } = require('../../utils/tokenCrypto');

const KEY_PREFIX = 'pk_enr_';
const INTERVALS = { heartbeatSec: 300, inventorySec: 6 * 3600 };
const PLATFORMS = ['windows', 'macos', 'linux'];

const hashKey = (secret) => crypto.createHash('sha256').update(String(secret)).digest('hex');

const newSecret = () => KEY_PREFIX + crypto.randomBytes(32).toString('base64url');

function parseExpiry(expiresAt) {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime()) || expires <= new Date()) throw new ApiError(400, 'The expiry must be a date in the future', 'VALIDATION_ERROR');
  return expires;
}

// A limit on how many computers a key enrolls: null (none) or 1 to 100,000.
function parseMaxUses(maxUses) {
  if (maxUses === null || maxUses === undefined || maxUses === '') return null;
  const n = Number(maxUses);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new ApiError(400, 'The limit must be a whole number from 1 to 100,000', 'VALIDATION_ERROR');
  return n;
}

// A new key for a company. → { key, secret }. The secret is kept encrypted
// (8d) so staff with Manage devices can copy it again.
async function createEnrollmentKey({
  companyId, name, expiresAt = null, maxUses = null, userId = null,
}) {
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 100) : '';
  if (!cleanName) throw new ApiError(400, 'Give the key a name', 'VALIDATION_ERROR');
  const expires = parseExpiry(expiresAt);
  const limit = parseMaxUses(maxUses);
  const secret = newSecret();
  const created = await AgentEnrollmentKey.scope('withHash').create({
    companyId, name: cleanName, keyHash: hashKey(secret), secretEnc: encryptToken(secret), expiresAt: expires, maxUses: limit, createdById: userId,
  });
  return { key: await AgentEnrollmentKey.findByPk(created.id), secret };
}

// A key's secret, for staff to copy again; null for a key made before 8d
// (or one whose copy can't be read, e.g. ENCRYPTION_KEY changed).
async function revealSecret(key) {
  const stored = await AgentEnrollmentKey.scope('withHash').findByPk(key.id, { attributes: ['id', 'secretEnc'] });
  if (!stored || !stored.secretEnc) return null;
  try { return decryptToken(stored.secretEnc); } catch { return null; }
}

// A new secret for the same key (name, limits and history kept); the old one
// stops enrolling at once. → the new secret.
async function rotateSecret(key) {
  const secret = newSecret();
  await AgentEnrollmentKey.scope('withHash').update(
    { keyHash: hashKey(secret), secretEnc: encryptToken(secret) },
    { where: { id: key.id } }
  );
  return secret;
}

// The usable key a secret names, or null. Used by enrollment and the
// install links (8d).
async function findKeyBySecret(secret) {
  if (typeof secret !== 'string' || !secret.startsWith(KEY_PREFIX) || secret.length > 100) return null;
  return AgentEnrollmentKey.scope('withHash').findOne({ where: { keyHash: hashKey(secret) } });
}

// --- Enrollment ------------------------------------------------------------------

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function parseEnrollment(body) {
  const b = body || {};
  if (typeof b.enrollKey !== 'string' || !b.enrollKey.startsWith(KEY_PREFIX) || b.enrollKey.length > 100) {
    throw new ApiError(401, 'That enrollment key is not valid', 'ENROLL_KEY_INVALID');
  }
  let raw;
  try { raw = Buffer.from(String(b.publicKey || ''), 'base64'); } catch { raw = Buffer.alloc(0); }
  if (raw.length !== 32 || raw.toString('base64') !== b.publicKey) throw new ApiError(400, 'publicKey must be a raw Ed25519 public key, base64', 'VALIDATION_ERROR');
  if (!PLATFORMS.includes(b.platform)) throw new ApiError(400, `platform must be one of ${PLATFORMS.join(', ')}`, 'VALIDATION_ERROR');
  if (typeof b.arch !== 'string' || !/^[a-z0-9_]{1,20}$/.test(b.arch)) throw new ApiError(400, 'arch is not valid', 'VALIDATION_ERROR');
  if (typeof b.agentVersion !== 'string' || !/^[0-9A-Za-z.+-]{1,50}$/.test(b.agentVersion)) throw new ApiError(400, 'agentVersion is not valid', 'VALIDATION_ERROR');
  const hostname = str(b.hostname, 255);
  if (!hostname) throw new ApiError(400, 'hostname is required', 'VALIDATION_ERROR');
  return {
    secret: b.enrollKey,
    publicKey: b.publicKey,
    platform: b.platform,
    arch: b.arch,
    agentVersion: b.agentVersion,
    hostname,
    serialNumber: str(b.serialNumber, 150),
    make: str(b.make, 100),
    model: str(b.model, 100),
    // The package format it installs (8c); one not of its platform is left
    // unknown rather than trusted.
    packageFormat: validFormat(b.platform, b.packageFormat) ? b.packageFormat : null,
  };
}

// Serial numbers compare without case or spaces. Placeholder serials some
// makers ship ("To be filled by O.E.M.", "0", "Default string") never match.
const normalizeSerial = (s) => (s ? s.replace(/\s+/g, '').toLowerCase() : '');
const JUNK_SERIALS = new Set(['', '0', 'none', 'n/a', 'na', 'tobefilledbyo.e.m.', 'defaultstring', 'systemserialnumber', '0123456789', '123456789']);

async function computersCategory(transaction) {
  const [category] = await AssetCategory.findOrCreate({ where: { name: 'Computers' }, defaults: { name: 'Computers' }, transaction });
  return category;
}

const usedUp = () => new ApiError(403, 'This install key has been used up', 'ENROLL_KEY_USED_UP');

// One enrollment attempt, in one transaction. → { device, asset, claimed, created }
async function attemptEnrollment(p, key) {
  return sequelize.transaction(async (transaction) => {
    // 0. The key's row first, locked: enrollments with one key (a rollout)
    // take turns here, so each sees the current count and nothing it reads
    // later was changed under it. (MariaDB 11.6+ refuses to update a row
    // changed since a transaction's first read: innodb_snapshot_isolation.)
    const current = await AgentEnrollmentKey.findByPk(key.id, {
      attributes: ['id', 'enrolledCount', 'maxUses'], transaction, lock: transaction.LOCK.UPDATE,
    });

    // 1. Claim an Asset of this company with the same serial and no live device.
    let asset = null;
    let device = null;
    const serial = normalizeSerial(p.serialNumber);
    if (!JUNK_SERIALS.has(serial)) {
      const candidates = await Asset.findAll({
        where: {
          companyId: key.companyId,
          [Op.and]: [sqlWhere(fn('LOWER', fn('REPLACE', col('serialNumber'), ' ', '')), serial)],
        },
        include: [{ model: Device, as: 'device', required: false }],
        order: [['id', 'ASC']],
        transaction,
      });
      // Free to claim: no device, a revoked one, or one that never sent
      // its inventory. That last is an enrollment that failed on the
      // computer after PRISM accepted it (e.g. the key couldn't be saved,
      // 2026-11-05); with the same serial it's the same computer trying
      // again, so it takes that device over rather than make a second Asset.
      asset = candidates.find((a) => !a.device || a.device.revokedAt || !a.device.lastInventoryAt) || null;
      device = asset ? asset.device : null;
    }
    const claimed = !!asset;
    // The same computer trying again after a failed try (its device never
    // reported) doesn't use the key again (8d's limit).
    const retry = !!(device && !device.revokedAt && !device.lastInventoryAt && device.enrollmentKeyId === key.id);
    // The limit, checked under the key's lock, so a rollout can't go past it.
    if (!retry && current.maxUses !== null && current.maxUses !== undefined && current.enrolledCount >= current.maxUses) throw usedUp();

    // 2. Otherwise a new Asset in Computers.
    if (!asset) {
      const category = await computersCategory(transaction);
      asset = await Asset.create({
        assetTag: await suggestNextAssetTag(category, { transaction }),
        name: p.hostname,
        categoryId: category.id,
        companyId: key.companyId,
        make: p.make,
        model: p.model,
        serialNumber: p.serialNumber,
        status: 'active',
      }, { transaction });
    }

    const fields = {
      assetId: asset.id,
      companyId: key.companyId,
      enrollmentKeyId: key.id,
      publicKey: p.publicKey,
      platform: p.platform,
      arch: p.arch,
      agentVersion: p.agentVersion,
      hostname: p.hostname,
      packageFormat: p.packageFormat,
      revokedAt: null,
      lastSeenAt: new Date(),
    };
    // A revoked (or never-reported) device on the claimed Asset is replaced:
    // new key, fresh start.
    // (Devices.assetId is unique, so two computers can't claim one Asset.)
    if (device) await device.update(fields, { transaction });
    else device = await Device.create(fields, { transaction });
    await AgentEnrollmentKey.update(
      { enrolledCount: current.enrolledCount + (retry ? 0 : 1), lastUsedAt: new Date() },
      { where: { id: key.id }, transaction }
    );
    return { device, asset, claimed, created: !claimed };
  });
}

// Computers enrolling at the same moment (a Group Policy rollout) can pick the
// same next asset tag, or claim the same Asset; the unique indexes refuse one,
// which tries again.
// The same goes for the database's own lock conflicts (a deadlock or a
// lock wait timeout) between those enrollments, e.g. on the install key's
// row when it has a limit (8d): MariaDB rolls one back, and it tries again.
const LOCK_ERRNOS = new Set([1213, 1205, 1020]); // deadlock, lock wait timeout, "record has changed"
const isClash = (err) => !!err && (err.name === 'SequelizeUniqueConstraintError'
  || LOCK_ERRNOS.has(err.parent && err.parent.errno) || LOCK_ERRNOS.has(err.original && err.original.errno));
const pause = (attempt) => new Promise((r) => { setTimeout(r, 20 + Math.floor(Math.random() * 40 * (attempt + 1))); });

// → { device, asset, created: bool, claimed: bool }
async function enroll(body, req) {
  const p = parseEnrollment(body);
  const key = await findKeyBySecret(p.secret);
  // A used-up key is checked in the transaction: the computer it already
  // enrolled may be trying again.
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) throw new ApiError(401, 'That enrollment key is not valid, has expired or was revoked', 'ENROLL_KEY_INVALID');
  const company = await Company.findByPk(key.companyId);
  if (!company || company.status !== 'active') throw new ApiError(401, 'That enrollment key is not valid', 'ENROLL_KEY_INVALID');

  let result;
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await attemptEnrollment(p, key); // eslint-disable-line no-await-in-loop
      break;
    } catch (err) {
      if (!isClash(err) || attempt >= 7) throw err;
      await pause(attempt); // eslint-disable-line no-await-in-loop
    }
  }

  await writeAudit({ user: null }, 'agent.enrolled', 'Device', result.device.id, {
    assetId: result.asset.id, companyId: key.companyId, keyId: key.id, hostname: p.hostname, claimed: result.claimed, ip: req ? req.ip : null,
  });
  return result;
}

module.exports = {
  createEnrollmentKey, revealSecret, rotateSecret, findKeyBySecret, parseExpiry, parseMaxUses, enroll, hashKey, normalizeSerial, INTERVALS, KEY_PREFIX,
};
