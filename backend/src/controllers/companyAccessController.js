// GET/PUT /users/:id/company-access and /roles/:id/company-access.
// Granting access is privilege-granting, like role assignment: it needs
// companies.manage_access, and a granter can only hand out companies they can
// reach themselves.
const { Op } = require('sequelize');
const {
  User, Role, Company, UserCompanyAccess, RoleCompanyAccess, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit, writeSystemAudit } = require('../middleware/audit');
const {
  parseRecordId, isUnfenceable, getUserCompanyIds, invalidateUserPermissions, invalidateAllPermissions,
} = require('../services/permissionService');

async function resolveCompanyIds(raw) {
  if (!Array.isArray(raw)) throw new ApiError(400, 'companyIds must be a list', 'VALIDATION_ERROR');
  const ids = [...new Set(raw.map(parseRecordId))];
  if (ids.some((id) => !id)) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  const found = await Company.count({ where: { id: { [Op.in]: ids.length ? ids : [-1] } } });
  if (found !== ids.length) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  return ids;
}

async function assertCanGrant(granter, companyIds) {
  const reachable = await getUserCompanyIds(granter);
  if (reachable !== null && companyIds.some((id) => !reachable.includes(id))) {
    throw new ApiError(403, 'You can only grant companies you can reach', 'FORBIDDEN');
  }
}

// The list as `reader` may see it: companies they can't reach are left out,
// so a fenced granter never learns another company's name.
async function describe(companyIds, reader) {
  const reachable = await getUserCompanyIds(reader);
  const visible = reachable === null ? companyIds : companyIds.filter((id) => reachable.includes(id));
  const companies = visible.length
    ? await Company.findAll({ where: { id: visible }, attributes: ['id', 'name'], order: [['name', 'ASC']] })
    : [];
  return { companyIds: companies.map((c) => c.id), companies };
}

// What a save leaves in place: a fenced granter manages only the companies
// they can reach, so the ones they can't see (and so can't have meant to
// remove) are kept.
async function mergeWithUnseen(granter, requested, before) {
  const reachable = await getUserCompanyIds(granter);
  if (reachable === null) return requested;
  return [...new Set([...requested, ...before.filter((id) => !reachable.includes(id))])];
}

const getUserAccess = asyncHandler(async (req, res) => {
  const user = await User.findByPk(parseRecordId(req.params.id) || 0);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  const rows = await UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] });
  res.json({
    access: {
      allCompanies: user.allCompanies,
      ...(await describe(rows.map((r) => r.companyId), req.user)),
      unfenceable: await isUnfenceable(user),
    },
  });
});

const putUserAccess = asyncHandler(async (req, res) => {
  const user = await User.findByPk(parseRecordId(req.params.id) || 0);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  const { allCompanies, companyIds } = req.body || {};
  if (typeof allCompanies !== 'boolean') throw new ApiError(400, 'allCompanies must be true or false', 'VALIDATION_ERROR');
  if (!allCompanies && (await isUnfenceable(user))) {
    throw new ApiError(400, 'System Administrators always reach every company', 'VALIDATION_ERROR');
  }
  const requested = allCompanies ? [] : await resolveCompanyIds(companyIds || []);
  await assertCanGrant(req.user, requested);
  // "All companies" covers companies a fenced granter can't see, so only a
  // granter who reaches every company may switch it either way.
  if (allCompanies !== user.allCompanies && (await getUserCompanyIds(req.user)) !== null) {
    throw new ApiError(403, 'Only a user who reaches every company can change "all companies"', 'FORBIDDEN');
  }

  const before = (await UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] })).map((r) => r.companyId);
  const ids = allCompanies ? [] : await mergeWithUnseen(req.user, requested, before);
  await sequelize.transaction(async (t) => {
    await user.update({ allCompanies }, { transaction: t });
    await UserCompanyAccess.destroy({ where: { userId: user.id }, transaction: t });
    if (ids.length) await UserCompanyAccess.bulkCreate(ids.map((companyId) => ({ userId: user.id, companyId })), { transaction: t });
  });
  invalidateUserPermissions(user.id);

  const granted = ids.filter((id) => !before.includes(id));
  const revoked = before.filter((id) => !ids.includes(id));
  await writeAudit(req, 'user.company_access', 'User', user.id, { allCompanies, companyIds: ids });
  if (granted.length || allCompanies) await writeSystemAudit(req, 'company_access_granted', user.id, { allCompanies, companyIds: granted });
  if (revoked.length) await writeSystemAudit(req, 'company_access_revoked', user.id, { companyIds: revoked });

  res.json({ access: { allCompanies, ...(await describe(ids, req.user)), unfenceable: await isUnfenceable(user) } });
});

const getRoleAccess = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(parseRecordId(req.params.id) || 0);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  const rows = await RoleCompanyAccess.findAll({ where: { roleId: role.id }, attributes: ['companyId'] });
  res.json({ access: await describe(rows.map((r) => r.companyId), req.user) });
});

const putRoleAccess = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(parseRecordId(req.params.id) || 0);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  const requested = await resolveCompanyIds((req.body || {}).companyIds || []);
  await assertCanGrant(req.user, requested);
  const before = (await RoleCompanyAccess.findAll({ where: { roleId: role.id }, attributes: ['companyId'] })).map((r) => r.companyId);
  const ids = await mergeWithUnseen(req.user, requested, before);
  await sequelize.transaction(async (t) => {
    await RoleCompanyAccess.destroy({ where: { roleId: role.id }, transaction: t });
    if (ids.length) await RoleCompanyAccess.bulkCreate(ids.map((companyId) => ({ roleId: role.id, companyId })), { transaction: t });
  });
  invalidateAllPermissions();
  await writeAudit(req, 'role.company_access', 'Role', role.id, { companyIds: ids });
  res.json({ access: await describe(ids, req.user) });
});

module.exports = {
  getUserAccess, putUserAccess, getRoleAccess, putRoleAccess,
};
