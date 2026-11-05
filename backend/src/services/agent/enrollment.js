// PRISM agent enrolment (8a). Staff create per-company enrolment keys; an
// install command carries one, and the agent trades it, with its own
// Ed25519 public key, for a device identity. Every later agent request is
// signed with that key (middleware/agentAuth).
//
// An enrolment only ever creates or claims Assets in its key's company: it
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

const KEY_PREFIX = 'pk_enr_';
const INTERVALS = { heartbeatSec: 300, inventorySec: 6 * 3600 };
const PLATFORMS = ['windows', 'macos', 'linux'];

const hashKey = (secret) => crypto.createHash('sha256').update(String(secret)).digest('hex');

// A new key for a company. → { key, secret }: the secret exists only here.
async function createEnrollmentKey({ companyId, name, expiresAt = null, userId = null }) {
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 100) : '';
  if (!cleanName) throw new ApiError(400, 'Give the key a name', 'VALIDATION_ERROR');
  let expires = null;
  if (expiresAt) {
    expires = new Date(expiresAt);
    if (Number.isNaN(expires.getTime()) || expires <= new Date()) throw new ApiError(400, 'The expiry must be a date in the future', 'VALIDATION_ERROR');
  }
  const secret = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  const created = await AgentEnrollmentKey.scope('withHash').create({
    companyId, name: cleanName, keyHash: hashKey(secret), expiresAt: expires, createdById: userId,
  });
  return { key: await AgentEnrollmentKey.findByPk(created.id), secret };
}

// --- Enrolment ------------------------------------------------------------------

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function parseEnrollment(body) {
  const b = body || {};
  if (typeof b.enrollKey !== 'string' || !b.enrollKey.startsWith(KEY_PREFIX) || b.enrollKey.length > 100) {
    throw new ApiError(401, 'That enrolment key is not valid', 'ENROLL_KEY_INVALID');
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

// One enrolment attempt, in one transaction. → { device, asset, claimed, created }
async function attemptEnrollment(p, key) {
  return sequelize.transaction(async (transaction) => {
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
      // its inventory. That last is an enrolment that failed on the
      // computer after PRISM accepted it (e.g. the key couldn't be saved,
      // 2026-11-05); with the same serial it's the same computer trying
      // again, so it takes that device over rather than make a second Asset.
      asset = candidates.find((a) => !a.device || a.device.revokedAt || !a.device.lastInventoryAt) || null;
      device = asset ? asset.device : null;
    }
    const claimed = !!asset;

    // 2. Otherwise a new Asset in Computers.
    if (!asset) {
      const category = await computersCategory(transaction);
      asset = await Asset.create({
        assetTag: await suggestNextAssetTag(category),
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
      revokedAt: null,
      lastSeenAt: new Date(),
    };
    // A revoked (or never-reported) device on the claimed Asset is replaced:
    // new key, fresh start.
    // (Devices.assetId is unique, so two computers can't claim one Asset.)
    if (device) await device.update(fields, { transaction });
    else device = await Device.create(fields, { transaction });
    await AgentEnrollmentKey.increment('enrolledCount', { where: { id: key.id }, transaction });
    return { device, asset, claimed, created: !claimed };
  });
}

// Computers enrolling at the same moment (a Group Policy rollout) can pick the
// same next asset tag, or claim the same Asset; the unique indexes refuse one,
// which tries again.
const isClash = (err) => err && err.name === 'SequelizeUniqueConstraintError';

// → { device, asset, created: bool, claimed: bool }
async function enroll(body, req) {
  const p = parseEnrollment(body);
  const key = await AgentEnrollmentKey.scope('withHash').findOne({ where: { keyHash: hashKey(p.secret) } });
  if (!key || !key.isUsable()) throw new ApiError(401, 'That enrolment key is not valid, has expired or was revoked', 'ENROLL_KEY_INVALID');
  const company = await Company.findByPk(key.companyId);
  if (!company || company.status !== 'active') throw new ApiError(401, 'That enrolment key is not valid', 'ENROLL_KEY_INVALID');

  let result;
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await attemptEnrollment(p, key); // eslint-disable-line no-await-in-loop
      break;
    } catch (err) {
      if (!isClash(err) || attempt >= 4) throw err;
    }
  }

  await writeAudit({ user: null }, 'agent.enrolled', 'Device', result.device.id, {
    assetId: result.asset.id, companyId: key.companyId, keyId: key.id, hostname: p.hostname, claimed: result.claimed, ip: req ? req.ip : null,
  });
  return result;
}

module.exports = {
  createEnrollmentKey, enroll, hashKey, normalizeSerial, INTERVALS, KEY_PREFIX,
};
