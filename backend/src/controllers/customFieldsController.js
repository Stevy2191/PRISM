const { Op } = require('sequelize');
const { CustomField, TicketFieldValue, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission } = require('../services/permissionService');

const FIELD_TYPES = [
  'text', 'textarea', 'number', 'date', 'datetime',
  'dropdown', 'multiselect', 'checkbox', 'url', 'email', 'phone',
];
const TICKET_TYPES = ['incident', 'request', 'problem', 'change'];
const OPTION_TYPES = ['dropdown', 'multiselect'];
const FIELD_KEY_RE = /^[a-z0-9_]+$/;

const include = [{ model: User, as: 'creator', attributes: ['id', 'displayName'] }];

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'field';
}

async function uniqueFieldKey(base, excludeId) {
  let key = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await CustomField.findOne({ where: { fieldKey: key, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) } })) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

// Validates and normalizes the request body. `existing` is the current row
// for partial updates (so e.g. changing only `label` doesn't require
// re-supplying `fieldType` to validate `options`).
async function validate(body, existing) {
  const out = {};

  const label = body.label !== undefined ? body.label : existing?.label;
  if (!label || !String(label).trim()) {
    throw new ApiError(400, 'Field label is required', 'VALIDATION_ERROR');
  }
  if (body.label !== undefined) out.label = label.trim();

  const fieldType = body.fieldType !== undefined ? body.fieldType : (existing?.fieldType || 'text');
  if (!FIELD_TYPES.includes(fieldType)) {
    throw new ApiError(400, 'Invalid field type', 'VALIDATION_ERROR');
  }
  if (body.fieldType !== undefined || !existing) out.fieldType = fieldType;

  // Field key: explicit value is validated/uniqueness-checked; otherwise
  // (create only) auto-generate from the label.
  if (body.fieldKey !== undefined) {
    const key = String(body.fieldKey).trim().toLowerCase();
    if (!FIELD_KEY_RE.test(key)) {
      throw new ApiError(400, 'Field key may only contain lowercase letters, numbers, and underscores', 'VALIDATION_ERROR');
    }
    const conflict = await CustomField.findOne({
      where: { fieldKey: key, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) },
    });
    if (conflict) throw new ApiError(409, 'A field with this key already exists', 'FIELD_KEY_TAKEN');
    out.fieldKey = key;
  } else if (!existing) {
    out.fieldKey = await uniqueFieldKey(slugify(label));
  }

  if (body.ticketTypes !== undefined) {
    const types = Array.isArray(body.ticketTypes) ? body.ticketTypes.filter(Boolean) : [];
    if (types.some((t) => !TICKET_TYPES.includes(t))) {
      throw new ApiError(400, 'Invalid ticket type in ticketTypes', 'VALIDATION_ERROR');
    }
    out.ticketTypes = types.length ? types : null;
  }

  if (OPTION_TYPES.includes(fieldType)) {
    if (body.options !== undefined || !existing) {
      const options = Array.isArray(body.options)
        ? body.options.map((o) => String(o).trim()).filter(Boolean)
        : [];
      if (options.length < 2) {
        throw new ApiError(400, 'Dropdown/multiselect fields need at least 2 options', 'VALIDATION_ERROR');
      }
      out.options = options;
    }
  } else if (body.fieldType !== undefined) {
    out.options = null;
  }

  if (body.isRequired !== undefined) out.isRequired = !!body.isRequired;
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  if (body.placeholder !== undefined) out.placeholder = body.placeholder || null;
  if (body.defaultValue !== undefined) out.defaultValue = body.defaultValue || null;

  return out;
}

// GET /custom-fields — admins see every field; everyone else sees active
// fields only. ?ticketType=incident narrows to active fields that apply to
// that type (unscoped or explicitly listing it) — used to populate forms.
const list = asyncHandler(async (req, res) => {
  const { ticketType } = req.query;
  const where = {};

  if (ticketType) {
    where.isActive = true;
  } else if (!(await hasPermission(req.user.id, 'settings.manage_system'))) {
    where.isActive = true;
  }

  const fields = await CustomField.findAll({
    where,
    include,
    order: [['position', 'ASC'], ['id', 'ASC']],
  });

  const filtered = ticketType
    ? fields.filter((f) => !f.ticketTypes || f.ticketTypes.length === 0 || f.ticketTypes.includes(ticketType))
    : fields;

  res.json({ customFields: filtered });
});

const get = asyncHandler(async (req, res) => {
  const field = await CustomField.findByPk(req.params.id, { include });
  if (!field) throw new ApiError(404, 'Custom field not found', 'NOT_FOUND');
  res.json({ customField: field });
});

// POST /custom-fields — requires settings.manage_system
const create = asyncHandler(async (req, res) => {
  const data = await validate(req.body || {});
  const maxPosition = await CustomField.max('position');
  const field = await CustomField.create({ ...data, position: (maxPosition || 0) + 1, createdBy: req.user.id });
  await writeAudit(req, 'customField.create', 'CustomField', field.id, { label: field.label });
  const fresh = await CustomField.findByPk(field.id, { include });
  res.status(201).json({ customField: fresh });
});

// PATCH /custom-fields/:id — requires settings.manage_system
const update = asyncHandler(async (req, res) => {
  const field = await CustomField.findByPk(req.params.id);
  if (!field) throw new ApiError(404, 'Custom field not found', 'NOT_FOUND');
  const data = await validate(req.body || {}, field);
  await field.update(data);
  await writeAudit(req, 'customField.update', 'CustomField', field.id, { label: field.label });
  const fresh = await CustomField.findByPk(field.id, { include });
  res.json({ customField: fresh });
});

// DELETE /custom-fields/:id — warns (409) if any ticket has a value for it,
// unless ?force=true is passed.
const remove = asyncHandler(async (req, res) => {
  const field = await CustomField.findByPk(req.params.id);
  if (!field) throw new ApiError(404, 'Custom field not found', 'NOT_FOUND');

  if (req.query.force !== 'true') {
    const valueCount = await TicketFieldValue.count({ where: { fieldId: field.id } });
    if (valueCount > 0) {
      throw new ApiError(
        409,
        `${valueCount} ticket${valueCount === 1 ? ' has a value' : 's have values'} for "${field.label}". Delete anyway?`,
        'HAS_VALUES'
      );
    }
  }

  await field.destroy();
  await writeAudit(req, 'customField.delete', 'CustomField', field.id, { label: field.label });
  res.json({ ok: true });
});

// PATCH /custom-fields/reorder — Body: { order: [id, id, ...] }
const reorder = asyncHandler(async (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order.map((v) => parseInt(v, 10)).filter(Boolean) : [];
  if (!order.length) throw new ApiError(400, 'order must be a non-empty array of field ids', 'VALIDATION_ERROR');

  const fields = await CustomField.findAll({ where: { id: order } });
  if (fields.length !== order.length) {
    throw new ApiError(400, 'One or more fields do not exist', 'VALIDATION_ERROR');
  }

  await Promise.all(order.map((id, idx) => CustomField.update({ position: idx + 1 }, { where: { id } })));
  res.json({ ok: true });
});

module.exports = { list, get, create, update, remove, reorder };
