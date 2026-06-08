const { Blueprint, User, Department } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const include = [
  { model: User, as: 'createdBy', attributes: ['id', 'displayName', 'username'] },
  { model: Department, as: 'defaultDepartment', attributes: ['id', 'name'] },
];

const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];

// Validate the customFields array of field definitions.
function normalizeCustomFields(customFields) {
  if (customFields === undefined || customFields === null) return [];
  if (!Array.isArray(customFields)) {
    throw new ApiError(400, 'customFields must be an array', 'VALIDATION_ERROR');
  }
  return customFields.map((f, i) => {
    if (!f || !f.label || !f.label.trim()) {
      throw new ApiError(400, `Custom field ${i + 1} requires a label`, 'VALIDATION_ERROR');
    }
    const type = f.type || 'text';
    if (!FIELD_TYPES.includes(type)) {
      throw new ApiError(400, `Custom field "${f.label}" has an invalid type`, 'VALIDATION_ERROR');
    }
    const name = (f.name && f.name.trim()) || f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const def = { name, label: f.label.trim(), type, required: !!f.required };
    if (type === 'select') {
      const options = Array.isArray(f.options) ? f.options.filter((o) => o && String(o).trim()) : [];
      if (options.length === 0) {
        throw new ApiError(400, `Select field "${f.label}" needs at least one option`, 'VALIDATION_ERROR');
      }
      def.options = options.map((o) => String(o).trim());
    }
    return def;
  });
}

// GET /blueprints — all authenticated users
const list = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.category) where.category = req.query.category;
  const blueprints = await Blueprint.findAll({
    where,
    include,
    order: [['category', 'ASC'], ['name', 'ASC']],
  });
  res.json({ blueprints });
});

// GET /blueprints/:id
const get = asyncHandler(async (req, res) => {
  const blueprint = await Blueprint.findByPk(req.params.id, { include });
  if (!blueprint) throw new ApiError(404, 'Blueprint not found', 'NOT_FOUND');
  res.json({ blueprint });
});

// POST /blueprints — Admin/Technician
const create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) {
    throw new ApiError(400, 'Blueprint name is required', 'VALIDATION_ERROR');
  }
  const blueprint = await Blueprint.create({
    name: b.name.trim(),
    description: b.description || null,
    category: b.category || null,
    defaultTitle: b.defaultTitle || null,
    defaultDescription: b.defaultDescription || null,
    defaultPriority: b.defaultPriority || null,
    defaultType: b.defaultType || null,
    defaultDepartmentId: b.defaultDepartmentId || null,
    customFields: normalizeCustomFields(b.customFields),
    createdById: req.user.id,
  });
  await writeAudit(req, 'blueprint.create', 'Blueprint', blueprint.id, { name: blueprint.name });

  const fresh = await Blueprint.findByPk(blueprint.id, { include });
  res.status(201).json({ blueprint: fresh });
});

// PATCH /blueprints/:id — Admin/Technician
const update = asyncHandler(async (req, res) => {
  const blueprint = await Blueprint.findByPk(req.params.id);
  if (!blueprint) throw new ApiError(404, 'Blueprint not found', 'NOT_FOUND');

  const b = req.body || {};
  const changes = {};
  for (const key of [
    'name', 'description', 'category', 'defaultTitle', 'defaultDescription',
    'defaultPriority', 'defaultType', 'defaultDepartmentId',
  ]) {
    if (b[key] !== undefined) changes[key] = b[key] === '' ? null : b[key];
  }
  if (b.customFields !== undefined) changes.customFields = normalizeCustomFields(b.customFields);

  await blueprint.update(changes);
  await writeAudit(req, 'blueprint.update', 'Blueprint', blueprint.id, { name: blueprint.name });

  const fresh = await Blueprint.findByPk(blueprint.id, { include });
  res.json({ blueprint: fresh });
});

// DELETE /blueprints/:id — Admin/Technician
const remove = asyncHandler(async (req, res) => {
  const blueprint = await Blueprint.findByPk(req.params.id);
  if (!blueprint) throw new ApiError(404, 'Blueprint not found', 'NOT_FOUND');
  await blueprint.destroy();
  await writeAudit(req, 'blueprint.delete', 'Blueprint', blueprint.id, { name: blueprint.name });
  res.json({ ok: true });
});

module.exports = { list, get, create, update, remove };
