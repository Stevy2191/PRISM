const { fn, col, Op } = require('sequelize');
const { suggestCode, uniqueCode, isValidCode } = require('../services/codes');
const {
  Department, User, Role, Company, Contact, Asset, License, Contract, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const {
  canAccessCompany, companyScopeWhere, hasPermission, parseRecordId,
} = require('../services/permissionService');
const { getInternalCompanyId } = require('../services/companyService');
const { andWhere } = require('../services/recordScope');
const { assertCanHandOutRole } = require('../services/roleGrant');
const { isTopRole } = require('../services/ownership');

const departmentInclude = [
  { model: Role, as: 'defaultRole', attributes: ['id', 'name'] },
  { model: Company, as: 'company', attributes: ['id', 'name', 'isInternal'] },
];

// Departments belong to a company (client companies, sub-project 2). The
// internal company's departments are the organization's own and stay under
// people.manage_departments; a client's departments are company data and
// need companies.manage.
async function assertCanManageDepartmentsOf(user, company) {
  const key = company.isInternal ? 'people.manage_departments' : 'companies.manage';
  if (!(await hasPermission(user.id, key))) {
    throw new ApiError(
      403,
      company.isInternal ? 'Managing departments needs people.manage_departments' : 'Managing a client company\'s departments needs companies.manage',
      'FORBIDDEN'
    );
  }
}

async function assertNameFreeInCompany(name, companyId, excludeId) {
  const where = { companyId, name };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  if (await Department.findOne({ where })) {
    throw new ApiError(409, 'This company already has a department with that name', 'DEPARTMENT_NAME_TAKEN');
  }
}

// Loads :id, refusing a department in a company the caller can't reach.
async function loadAccessibleDepartment(req, options = {}) {
  const department = await Department.findByPk(parseRecordId(req.params.id) || 0, options);
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');
  if (!(await canAccessCompany(req.user, department.companyId))) {
    throw new ApiError(403, 'You do not have access to this department', 'FORBIDDEN');
  }
  return department;
}
const SHORT_CODE_MAX = 6;

// Normalizes + validates a department's code (CN: HR, FIN): letters and
// digits, at most 6, unique within its company (it sits in project numbers,
// WC-HR-P0007; Acme can have its own HR). excludeId lets update() check
// against every *other* department.
// Phase 3: the support tier a department's people get by default.
function cleanTier(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!['full', 'light', 'none'].includes(raw)) throw new ApiError(400, 'The support tier must be full, light or none', 'VALIDATION_ERROR');
  return raw;
}

async function normalizeShortCode(shortCode, companyId, excludeId) {
  const trimmed = shortCode.trim().toUpperCase();
  if (!isValidCode(trimmed, { min: 1, max: SHORT_CODE_MAX })) {
    throw new ApiError(400, `A department code is 1 to ${SHORT_CODE_MAX} letters or digits`, 'VALIDATION_ERROR');
  }
  const where = { shortCode: trimmed, companyId };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await Department.findOne({ where });
  if (existing) {
    throw new ApiError(409, `Code "${trimmed}" is already used by another department of this company`, 'SHORT_CODE_TAKEN');
  }
  return trimmed;
}

// The code a new department gets when none is given: from its name, unique
// within its company (Human Resources → HR, a second → HR2).
async function suggestDepartmentCode(name, companyId) {
  const taken = (await Department.findAll({ where: { companyId }, attributes: ['shortCode'] })).map((d) => d.shortCode);
  return uniqueCode(suggestCode(name, { max: SHORT_CODE_MAX, single: 3 }), taken, SHORT_CODE_MAX);
}

async function memberCounts() {
  const rows = await User.findAll({
    attributes: ['departmentId', [fn('COUNT', col('id')), 'count']],
    where: { departmentId: { [Op.ne]: null } },
    group: ['departmentId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.departmentId, Number(r.count)]));
}

// GET /departments
const list = asyncHandler(async (req, res) => {
  const [departments, counts] = await Promise.all([
    Department.findAll({
      where: andWhere(
        await companyScopeWhere(req.user),
        req.query.companyId ? { companyId: parseRecordId(req.query.companyId) || -1 } : {}
      ),
      include: departmentInclude,
      order: [['name', 'ASC']],
    }),
    memberCounts(),
  ]);
  const withCounts = departments.map((d) => {
    const json = d.toJSON();
    json.memberCount = counts.get(d.id) || 0;
    return json;
  });
  res.json({ departments: withCounts });
});

// A department's default role is handed to every account later created in it
// (and to users whose primary role is removed), so setting one is
// privilege-granting like assigning the role itself (S11).
async function resolveDefaultRole(req, rawRoleId) {
  const role = await Role.findByPk(parseRecordId(rawRoleId) || 0);
  if (!role) throw new ApiError(400, 'Default role does not exist', 'VALIDATION_ERROR');
  // Never automatically: a default reaches every account created in the
  // department, and anyone whose main role is removed (Owner review M1).
  if (isTopRole(role)) throw new ApiError(400, 'A department\'s default role can\'t be System Administrator', 'VALIDATION_ERROR');
  if (!(await hasPermission(req.user.id, 'people.manage_roles'))) {
    throw new ApiError(403, 'Setting a default role needs people.manage_roles', 'FORBIDDEN');
  }
  await assertCanHandOutRole(req.user, role);
  return role.id;
}

// GET /departments/owners — the internal departments a project can be
// "owned by". Every project creator needs them, including users fenced to
// client companies who can't otherwise list internal departments (plan 2b
// ruling: these are the organization's own teams, not client data).
const owners = asyncHandler(async (req, res) => {
  const departments = await Department.findAll({
    where: { companyId: await getInternalCompanyId() },
    attributes: ['id', 'name', 'shortCode'],
    order: [['name', 'ASC']],
  });
  res.json({ departments });
});

// POST /departments
const create = asyncHandler(async (req, res) => {
  const { name, description, shortCode, defaultRoleId } = req.body || {};
  const defaultSupportTier = cleanTier((req.body || {}).defaultSupportTier);
  const rawCompanyId = (req.body || {}).companyId;
  const company = await Company.findByPk(
    rawCompanyId === undefined || rawCompanyId === null || rawCompanyId === ''
      ? await getInternalCompanyId()
      : (parseRecordId(rawCompanyId) || 0)
  );
  if (!company || !(await canAccessCompany(req.user, company.id))) {
    throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  }
  await assertCanManageDepartmentsOf(req.user, company);
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Department name is required', 'VALIDATION_ERROR');
  }
  await assertNameFreeInCompany(name.trim(), company.id);
  // Every department has a code (CN), suggested from its name when not given.
  const normalizedShortCode = shortCode && shortCode.trim()
    ? await normalizeShortCode(shortCode, company.id)
    : await suggestDepartmentCode(name.trim(), company.id);
  const resolvedDefaultRoleId = defaultRoleId ? await resolveDefaultRole(req, defaultRoleId) : null;
  const department = await Department.create({
    companyId: company.id,
    name: name.trim(),
    description: description || null,
    shortCode: normalizedShortCode,
    defaultRoleId: resolvedDefaultRoleId,
    ...(defaultSupportTier ? { defaultSupportTier } : {}),
  });
  await writeAudit(req, 'department.create', 'Department', department.id, { name: department.name });

  const fresh = await Department.findByPk(department.id, { include: departmentInclude });
  res.status(201).json({ department: { ...fresh.toJSON(), memberCount: 0 } });
});

// GET /departments/:id
const get = asyncHandler(async (req, res) => {
  const department = await loadAccessibleDepartment(req, { include: departmentInclude });
  const memberCount = await User.count({ where: { departmentId: department.id } });
  res.json({ department: { ...department.toJSON(), memberCount } });
});

// PATCH /departments/:id
const update = asyncHandler(async (req, res) => {
  const department = await loadAccessibleDepartment(req);
  await assertCanManageDepartmentsOf(req.user, await Company.findByPk(department.companyId));

  const { name, description, shortCode, defaultRoleId } = req.body || {};
  const changes = {};
  if (name !== undefined) {
    if (!name || !name.trim()) throw new ApiError(400, 'Department name is required', 'VALIDATION_ERROR');
    changes.name = name.trim();
    await assertNameFreeInCompany(changes.name, department.companyId, department.id);
  }
  if (description !== undefined) changes.description = description;
  if (shortCode !== undefined) {
    if (!shortCode || !String(shortCode).trim()) throw new ApiError(400, 'A department needs a code', 'VALIDATION_ERROR');
    changes.shortCode = await normalizeShortCode(shortCode, department.companyId, department.id);
  }
  if (defaultRoleId !== undefined) {
    // Re-sending the current default (the whole form comes back) isn't a grant.
    const unchanged = (parseRecordId(defaultRoleId) || null) === department.defaultRoleId;
    if (!defaultRoleId) changes.defaultRoleId = null;
    else if (!unchanged) changes.defaultRoleId = await resolveDefaultRole(req, defaultRoleId);
  }

  const tier = cleanTier((req.body || {}).defaultSupportTier);
  if (tier) changes.defaultSupportTier = tier;
  await department.update(changes);
  await writeAudit(req, 'department.update', 'Department', department.id, changes);

  const fresh = await Department.findByPk(department.id, { include: departmentInclude });
  const memberCount = await User.count({ where: { departmentId: department.id } });
  res.json({ department: { ...fresh.toJSON(), memberCount } });
});

// DELETE /departments/:id
const remove = asyncHandler(async (req, res) => {
  const department = await loadAccessibleDepartment(req);
  await assertCanManageDepartmentsOf(req.user, await Company.findByPk(department.companyId));

  // Contacts, assets, licenses and contracts keep their department as a
  // plain id (no foreign key), so clear it with the department rather than
  // leave them pointing at one that's gone.
  await sequelize.transaction(async (transaction) => {
    for (const M of [Contact, Asset, License, Contract]) {
      // eslint-disable-next-line no-await-in-loop
      await M.update({ departmentId: null }, { where: { departmentId: department.id }, transaction, hooks: false });
    }
    await department.destroy({ transaction });
  });
  await writeAudit(req, 'department.delete', 'Department', department.id, { name: department.name });
  res.json({ ok: true });
});

module.exports = {
  list, owners, create, get, update, remove,
  // For Microsoft 365's "Create department" (7b): the same checks.
  assertCanManageDepartmentsOf, assertNameFreeInCompany, normalizeShortCode, suggestDepartmentCode,
};
