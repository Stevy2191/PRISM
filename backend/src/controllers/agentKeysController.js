// A company's agent install (enrollment) keys (8a, 8d): list, create,
// reveal (copy again), rotate, revoke. Needs devices.manage (route) and the
// company in the caller's reach. A secret is only ever in the answer to
// create, reveal or rotate, never in a list, and each reveal is audited.
const { AgentEnrollmentKey, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const { loadAccessibleCompany } = require('./companiesController');
const {
  createEnrollmentKey, revealSecret, rotateSecret,
} = require('../services/agent/enrollment');

const keyJson = (k) => ({
  id: k.id,
  name: k.name,
  createdAt: k.createdAt,
  createdBy: k.createdBy ? { id: k.createdBy.id, displayName: k.createdBy.displayName } : null,
  expiresAt: k.expiresAt,
  revokedAt: k.revokedAt,
  enrolledCount: k.enrolledCount,
  maxUses: k.maxUses,
  lastUsedAt: k.lastUsedAt,
  usedUp: k.isUsedUp(),
  // Made before keys could be copied again (8d): rotate it to copy it.
  copyable: !!k.secretEnc,
  usable: k.isUsable(),
});

const withCreator = [{ model: User, as: 'createdBy', attributes: ['id', 'displayName'] }];
// secretEnc is read only to say whether a copy exists; keyJson never sends it.
const loadKeys = (where) => AgentEnrollmentKey.scope('withHash').findAll({
  where, include: withCreator, order: [['revokedAt', 'ASC'], ['createdAt', 'DESC']],
});

async function loadKey(req, company) {
  const [key] = await loadKeys({ id: parseRecordId(req.params.keyId) || 0, companyId: company.id });
  if (!key) throw new ApiError(404, 'Enrollment key not found', 'NOT_FOUND');
  return key;
}

// GET /companies/:id/agent-keys
const list = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const keys = await loadKeys({ companyId: company.id });
  res.json({ keys: keys.map(keyJson) });
});

// POST /companies/:id/agent-keys { name, expiresAt?, maxUses? } → { key, secret }
const create = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  if (company.status !== 'active') throw new ApiError(400, 'This company is inactive', 'VALIDATION_ERROR');
  const { name, expiresAt, maxUses } = req.body || {};
  const { key, secret } = await createEnrollmentKey({
    companyId: company.id, name, expiresAt, maxUses, userId: req.user.id,
  });
  await writeAudit(req, 'agent.key_created', 'Company', company.id, {
    keyId: key.id, name: key.name, expiresAt: key.expiresAt, maxUses: key.maxUses,
  });
  const [fresh] = await loadKeys({ id: key.id });
  res.status(201).json({ key: keyJson(fresh), secret });
});

// POST /companies/:id/agent-keys/:keyId/revoke — computers already enrolled
// with it keep working; only new enrollments stop.
const revoke = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const key = await loadKey(req, company);
  if (!key.revokedAt) {
    await key.update({ revokedAt: new Date() });
    await writeAudit(req, 'agent.key_revoked', 'Company', company.id, { keyId: key.id, name: key.name });
  }
  res.json({ key: keyJson(key) });
});

// POST /companies/:id/agent-keys/:keyId/reveal → { secret } (8d). Audited.
// A key made before 8d has no copy: 409, rotate it instead.
const reveal = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const key = await loadKey(req, company);
  if (key.revokedAt) throw new ApiError(400, 'This key was revoked', 'VALIDATION_ERROR');
  const secret = await revealSecret(key);
  if (!secret) throw new ApiError(409, 'This key was made before keys could be copied again. Rotate it to get one you can copy.', 'KEY_NOT_COPYABLE');
  await writeAudit(req, 'agent.key_revealed', 'Company', company.id, { keyId: key.id, name: key.name });
  res.json({ secret });
});

// POST /companies/:id/agent-keys/:keyId/rotate → { key, secret } (8d): a
// new secret; the old one (and its install links) stop working at once.
// Computers already enrolled keep working.
const rotate = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const key = await loadKey(req, company);
  if (key.revokedAt) throw new ApiError(400, 'This key was revoked', 'VALIDATION_ERROR');
  const secret = await rotateSecret(key);
  await writeAudit(req, 'agent.key_rotated', 'Company', company.id, { keyId: key.id, name: key.name });
  const fresh = await loadKey(req, company);
  res.json({ key: keyJson(fresh), secret });
});

module.exports = {
  list, create, revoke, reveal, rotate,
};
