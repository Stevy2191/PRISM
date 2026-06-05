const { Department } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

// GET /departments
const list = asyncHandler(async (req, res) => {
  const departments = await Department.findAll({ order: [['name', 'ASC']] });
  res.json({ departments });
});

// POST /departments — Admin only
const create = asyncHandler(async (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Department name is required', 'VALIDATION_ERROR');
  }
  const department = await Department.create({ name: name.trim(), description: description || null });
  await writeAudit(req, 'department.create', 'Department', department.id, { name: department.name });
  res.status(201).json({ department });
});

// GET /departments/:id
const get = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');
  res.json({ department });
});

// PATCH /departments/:id — Admin only
const update = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');

  const { name, description } = req.body || {};
  const changes = {};
  if (name !== undefined) changes.name = name.trim();
  if (description !== undefined) changes.description = description;

  await department.update(changes);
  await writeAudit(req, 'department.update', 'Department', department.id, changes);
  res.json({ department });
});

// DELETE /departments/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found', 'NOT_FOUND');

  await department.destroy();
  await writeAudit(req, 'department.delete', 'Department', department.id, { name: department.name });
  res.json({ ok: true });
});

module.exports = { list, create, get, update, remove };
