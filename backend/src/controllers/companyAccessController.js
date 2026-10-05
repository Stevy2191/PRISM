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

async function describe(companyIds) {
  const companies = companyIds.length
    ? await Company.findAll({ where: { id: companyIds }, attributes: ['id', 'name'], order: [['name', 'ASC']] })
    : [];
  return { companyIds: companies.map((c) => c.id), companies };
}

const getUserAccess = asyncHandler(async (req, res) => {
  const user = await User.findByPk(parseRecordId(req.params.id) || 0);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  const rows = await UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] });
  res.json({
    access: {
      allCompanies: user.allCompanies,
      ...(await describe(rows.map((r) => r.companyId))),
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
  const ids = allCompanies ? [] : await resolveCompanyIds(companyIds || []);
  // Granting "all" is itself a grant of every company.
  if (allCompanies) {
    if ((await getUserCompanyIds(req.user)) !== null) {
      throw new ApiError(403, 'You can only grant companies you can reach', 'FORBIDDEN');
    }
  } else {
    await assertCanGrant(req.user, ids);
  }

  const before = (await UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] })).map((r) => r.companyId);
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

  res.json({ access: { allCompanies, ...(await describe(ids)), unfenceable: await isUnfenceable(user) } });
});

const getRoleAccess = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(parseRecordId(req.params.id) || 0);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  const rows = await RoleCompanyAccess.findAll({ where: { roleId: role.id }, attributes: ['companyId'] });
  res.json({ access: await describe(rows.map((r) => r.companyId)) });
});

const putRoleAccess = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(parseRecordId(req.params.id) || 0);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  const ids = await resolveCompanyIds((req.body || {}).companyIds || []);
  await assertCanGrant(req.user, ids);
  await sequelize.transaction(async (t) => {
    await RoleCompanyAccess.destroy({ where: { roleId: role.id }, transaction: t });
    if (ids.length) await RoleCompanyAccess.bulkCreate(ids.map((companyId) => ({ roleId: role.id, companyId })), { transaction: t });
  });
  invalidateAllPermissions();
  await writeAudit(req, 'role.company_access', 'Role', role.id, { companyIds: ids });
  res.json({ access: await describe(ids) });
});

module.exports = {
  getUserAccess, putUserAccess, getRoleAccess, putRoleAccess,
};
