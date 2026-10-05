const { fn, col, Op } = require('sequelize');
const { Department, User, Role, Company } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const {
  canAccessCompany, companyScopeWhere, hasPermission, parseRecordId,
} = require('../services/permissionService');
const { getInternalCompanyId } = require('../services/companyService');
const { andWhere } = require('../services/recordScope');
const { assertCanGrantRole } = require('../services/roleGrant');

const departmentInclude = [
  { model: Role, as: 'defaultRole', attributes: ['id', 'name'] },
  { model: Company, as: 'company', attributes: ['id', 'name'] },
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

// Normalizes + validates a short code (uppercase, max 6 chars, unique across
// departments — used to prefix project IDs like IT-P00001, so a collision
// would make two departments' project numbering ambiguous). excludeId lets
// update() check uniqueness against every *other* department.
async function normalizeShortCode(shortCode, excludeId) {
  const trimmed = shortCode.trim().toUpperCase();
  if (trimmed.length > SHORT_CODE_MAX) {
    throw new ApiError(400, `Short code must be ${SHORT_CODE_MAX} characters or fewer`, 'VALIDATION_ERROR');
  }
  const where = { shortCode: trimmed };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await Department.findOne({ where });
  if (existing) {
    throw new ApiError(409, `Short code "${trimmed}" is already used by another department`, 'SHORT_CODE_TAKEN');
  }
  return trimmed;
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
  if (!(await hasPermission(req.user.id, 'people.manage_roles'))) {
    throw new ApiError(403, 'Setting a default role needs people.manage_roles', 'FORBIDDEN');
  }
  await assertCanGrantRole(req.user, role);
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
  // Only internal departments own projects, so only they need a short code.
  if (company.isInternal && (!shortCode || !shortCode.trim())) {
    throw new ApiError(400, 'Short code is required (used to prefix this department\'s project IDs)', 'VALIDATION_ERROR');
  }
  await assertNameFreeInCompany(name.trim(), company.id);
  const normalizedShortCode = shortCode && shortCode.trim() ? await normalizeShortCode(shortCode) : null;
  const resolvedDefaultRoleId = defaultRoleId ? await resolveDefaultRole(req, defaultRoleId) : null;
  const department = await Department.create({
    companyId: company.id,
    name: name.trim(),
    description: description || null,
    shortCode: normalizedShortCode,
    defaultRoleId: resolvedDefaultRoleId,
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
    changes.shortCode = shortCode ? await normalizeShortCode(shortCode, department.id) : null;
  }
  if (defaultRoleId !== undefined) {
    // Re-sending the current default (the whole form comes back) isn't a grant.
    const unchanged = (parseRecordId(defaultRoleId) || null) === department.defaultRoleId;
    if (!defaultRoleId) changes.defaultRoleId = null;
    else if (!unchanged) changes.defaultRoleId = await resolveDefaultRole(req, defaultRoleId);
  }

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

  await department.destroy();
  await writeAudit(req, 'department.delete', 'Department', department.id, { name: department.name });
  res.json({ ok: true });
});

module.exports = {
  list, owners, create, get, update, remove,
};
