const { fn, col, Op } = require('sequelize');
const { Department, User, Role } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const departmentInclude = [{ model: Role, as: 'defaultRole', attributes: ['id', 'name'] }];
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
    Department.findAll({ include: departmentInclude, order: [['name', 'ASC']] }),
    memberCounts(),
  ]);
  const withCounts = departments.map((d) => {
    const json = d.toJSON();
    json.memberCount = counts.get(d.id) || 0;
    return json;
  });
  res.json({ departments: withCounts });
});

// POST /departments
const create = asyncHandler(async (req, res) => {
  const { name, description, shortCode, defaultRoleId } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Department name is required', 'VALIDATION_ERROR');
  }
  if (!shortCode || !shortCode.trim()) {
    throw new ApiError(400, 'Short code is required (used to prefix this department\'s project IDs)', 'VALIDATION_ERROR');
  }
  const normalizedShortCode = await normalizeShortCode(shortCode);
  if (defaultRoleId) {
    const role = await Role.findByPk(defaultRoleId);
    if (!role) throw new ApiError(400, 'Default role does not exist', 'VALIDATION_ERROR');
  }
  const department = await Department.create({
    name: name.trim(),
    description: description || null,
    shortCode: normalizedShortCode,
    defaultRoleId: defaultRoleId || null,
  });
  await writeAudit(req, 'department.create', 'Department', department.id, { name: department.name });

  const fresh = await Department.findByPk(department.id, { include: departmentInclude });
  res.status(201).json({ department: { ...fresh.toJSON(), memberCount: 0 } });
});

// GET /departments/:id
const get = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id, { include: departmentInclude });
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');
  const memberCount = await User.count({ where: { departmentId: department.id } });
  res.json({ department: { ...department.toJSON(), memberCount } });
});

// PATCH /departments/:id
const update = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');

  const { name, description, shortCode, defaultRoleId } = req.body || {};
  const changes = {};
  if (name !== undefined) changes.name = name.trim();
  if (description !== undefined) changes.description = description;
  if (shortCode !== undefined) {
    changes.shortCode = shortCode ? await normalizeShortCode(shortCode, department.id) : null;
  }
  if (defaultRoleId !== undefined) {
    if (defaultRoleId) {
      const role = await Role.findByPk(defaultRoleId);
      if (!role) throw new ApiError(400, 'Default role does not exist', 'VALIDATION_ERROR');
    }
    changes.defaultRoleId = defaultRoleId || null;
  }

  await department.update(changes);
  await writeAudit(req, 'department.update', 'Department', department.id, changes);

  const fresh = await Department.findByPk(department.id, { include: departmentInclude });
  const memberCount = await User.count({ where: { departmentId: department.id } });
  res.json({ department: { ...fresh.toJSON(), memberCount } });
});

// DELETE /departments/:id
const remove = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');

  await department.destroy();
  await writeAudit(req, 'department.delete', 'Department', department.id, { name: department.name });
  res.json({ ok: true });
});

module.exports = { list, create, get, update, remove };
