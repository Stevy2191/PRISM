// A company's agent enrollment keys (8a): list, create (the secret is shown
// once), revoke. Needs devices.manage (route) and the company in the caller's
// reach.
const { AgentEnrollmentKey, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const { loadAccessibleCompany } = require('./companiesController');
const { createEnrollmentKey } = require('../services/agent/enrollment');

const keyJson = (k) => ({
  id: k.id,
  name: k.name,
  createdAt: k.createdAt,
  createdBy: k.createdBy ? { id: k.createdBy.id, displayName: k.createdBy.displayName } : null,
  expiresAt: k.expiresAt,
  revokedAt: k.revokedAt,
  enrolledCount: k.enrolledCount,
  usable: k.isUsable(),
});

// GET /companies/:id/agent-keys
const list = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const keys = await AgentEnrollmentKey.findAll({
    where: { companyId: company.id },
    include: [{ model: User, as: 'createdBy', attributes: ['id', 'displayName'] }],
    order: [['revokedAt', 'ASC'], ['createdAt', 'DESC']],
  });
  res.json({ keys: keys.map(keyJson) });
});

// POST /companies/:id/agent-keys { name, expiresAt? } → { key, secret }
const create = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  if (company.status !== 'active') throw new ApiError(400, 'This company is inactive', 'VALIDATION_ERROR');
  const { name, expiresAt } = req.body || {};
  const { key, secret } = await createEnrollmentKey({
    companyId: company.id, name, expiresAt, userId: req.user.id,
  });
  await writeAudit(req, 'agent.key_created', 'Company', company.id, { keyId: key.id, name: key.name, expiresAt: key.expiresAt });
  const fresh = await AgentEnrollmentKey.findByPk(key.id, { include: [{ model: User, as: 'createdBy', attributes: ['id', 'displayName'] }] });
  res.status(201).json({ key: keyJson(fresh), secret });
});

// POST /companies/:id/agent-keys/:keyId/revoke — computers already enrolled
// with it keep working; only new enrollments stop.
const revoke = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const key = await AgentEnrollmentKey.findOne({ where: { id: parseRecordId(req.params.keyId) || 0, companyId: company.id } });
  if (!key) throw new ApiError(404, 'Enrollment key not found', 'NOT_FOUND');
  if (!key.revokedAt) {
    await key.update({ revokedAt: new Date() });
    await writeAudit(req, 'agent.key_revoked', 'Company', company.id, { keyId: key.id, name: key.name });
  }
  res.json({ key: keyJson(key) });
});

module.exports = { list, create, revoke };
