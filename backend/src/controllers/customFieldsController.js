const { Op } = require('sequelize');
const { CustomField, Department } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date', 'url'];
const TICKET_TYPES = ['incident', 'request', 'problem', 'task', 'change'];
const include = [{ model: Department, as: 'department', attributes: ['id', 'name'] }];

function validate(body, partial = false) {
  const out = {};
  if (body.name !== undefined || !partial) {
    if (!body.name || !body.name.trim()) throw new ApiError(400, 'Field name is required', 'VALIDATION_ERROR');
    out.name = body.name.trim();
  }
  if (body.fieldType !== undefined || !partial) {
    const ft = body.fieldType || 'text';
    if (!FIELD_TYPES.includes(ft)) throw new ApiError(400, 'Invalid field type', 'VALIDATION_ERROR');
    out.fieldType = ft;
  }
  const effectiveType = out.fieldType || body.fieldType;
  if (effectiveType === 'select') {
    const options = Array.isArray(body.options)
      ? body.options.map((o) => String(o).trim()).filter(Boolean)
      : [];
    if (!partial || body.options !== undefined) {
      if (options.length === 0) throw new ApiError(400, 'Select fields need at least one option', 'VALIDATION_ERROR');
      out.options = options;
    }
  } else if (body.fieldType !== undefined) {
    out.options = null;
  }
  if (body.required !== undefined) out.required = !!body.required;
  if (body.ticketType !== undefined) {
    if (body.ticketType && !TICKET_TYPES.includes(body.ticketType)) {
      throw new ApiError(400, 'Invalid ticket type', 'VALIDATION_ERROR');
    }
    out.ticketType = body.ticketType || null;
  }
  if (body.departmentId !== undefined) out.departmentId = body.departmentId || null;
  if (body.displayOrder !== undefined) out.displayOrder = parseInt(body.displayOrder, 10) || 0;
  return out;
}

// GET /custom-fields — any authenticated user (forms read this).
// Optional ?ticketType=&departmentId= returns only the fields that apply
// (matching type/department or unscoped).
const list = asyncHandler(async (req, res) => {
  const where = {};
  const { ticketType, departmentId } = req.query;
  if (ticketType) where.ticketType = { [Op.or]: [null, ticketType] };
  if (departmentId) where.departmentId = { [Op.or]: [null, parseInt(departmentId, 10)] };

  const fields = await CustomField.findAll({
    where,
    include,
    order: [['displayOrder', 'ASC'], ['id', 'ASC']],
  });
  res.json({ customFields: fields });
});

const get = asyncHandler(async (req, res) => {
  const field = await CustomField.findByPk(req.params.id, { include });
  if (!field) throw new ApiError(404, 'Custom field not found', 'NOT_FOUND');
  res.json({ customField: field });
});

// POST /custom-fields — Admin
const create = asyncHandler(async (req, res) => {
  const data = validate(req.body || {});
  const field = await CustomField.create(data);
  await writeAudit(req, 'customField.create', 'CustomField', field.id, { name: field.name });
  const fresh = await CustomField.findByPk(field.id, { include });
  res.status(201).json({ customField: fresh });
});

// PATCH /custom-fields/:id — Admin
const update = asyncHandler(async (req, res) => {
  const field = await CustomField.findByPk(req.params.id);
  if (!field) throw new ApiError(404, 'Custom field not found', 'NOT_FOUND');
  const data = validate({ fieldType: field.fieldType, ...req.body }, true);
  await field.update(data);
  await writeAudit(req, 'customField.update', 'CustomField', field.id, { name: field.name });
  const fresh = await CustomField.findByPk(field.id, { include });
  res.json({ customField: fresh });
});

// DELETE /custom-fields/:id — Admin
const remove = asyncHandler(async (req, res) => {
  const field = await CustomField.findByPk(req.params.id);
  if (!field) throw new ApiError(404, 'Custom field not found', 'NOT_FOUND');
  await field.destroy();
  await writeAudit(req, 'customField.delete', 'CustomField', field.id, { name: field.name });
  res.json({ ok: true });
});

module.exports = { list, get, create, update, remove };
