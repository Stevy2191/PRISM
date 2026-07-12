// Settings -> Customization -> Asset Categories: full category + per-
// category field CRUD. Distinct from assetsController.js's GET
// /assets/categories (which is the lightweight asset-form lookup returning
// a tag suggestion, not field counts/definitions) — this is the admin
// management surface, mirroring customFieldsController.js's shape closely.
const { Op } = require('sequelize');
const { AssetCategory, AssetCategoryField, AssetFieldValue, Asset } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const FIELD_TYPES = ['text', 'number', 'date', 'dropdown', 'toggle', 'phone', 'email'];
const FIELD_KEY_RE = /^[a-zA-Z0-9_]+$/;

function slugify(text) {
  const base = String(text || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'field';
}

async function uniqueFieldKey(categoryId, base, excludeId) {
  let key = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await AssetCategoryField.findOne({ where: { categoryId, fieldKey: key, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) } })) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

// GET /assets/categories/manage — full list with field counts, for the
// Settings page (list view doesn't need every field's full definition).
const list = asyncHandler(async (req, res) => {
  const categories = await AssetCategory.findAll({
    include: [{ model: AssetCategoryField, as: 'fields', attributes: ['id'] }],
    order: [['isBuiltIn', 'DESC'], ['name', 'ASC']],
  });
  res.json({
    categories: categories.map((c) => ({
      id: c.id, name: c.name, icon: c.icon, color: c.color, isBuiltIn: c.isBuiltIn,
      fieldCount: c.fields.length,
    })),
  });
});

// GET /assets/categories/:categoryId — full definition incl. ordered fields.
const get = asyncHandler(async (req, res) => {
  const category = await AssetCategory.findByPk(req.params.categoryId, {
    include: [{ model: AssetCategoryField, as: 'fields' }],
  });
  if (!category) throw new ApiError(404, 'Category not found', 'NOT_FOUND');
  const fields = [...category.fields].sort((a, b) => a.position - b.position);
  res.json({ category: { ...category.toJSON(), fields } });
});

const create = asyncHandler(async (req, res) => {
  const { name, icon, color } = req.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'Category name is required', 'VALIDATION_ERROR');
  const existing = await AssetCategory.findOne({ where: { name: name.trim() } });
  if (existing) throw new ApiError(409, 'A category with this name already exists', 'DUPLICATE_NAME');

  const category = await AssetCategory.create({ name: name.trim(), icon: icon || null, color: color || null, isBuiltIn: false });
  await writeAudit(req, 'assetCategory.create', 'AssetCategory', category.id, { name: category.name });
  res.status(201).json({ category: { ...category.toJSON(), fields: [] } });
});

// PATCH /assets/categories/:categoryId — name/icon/color editable on ANY
// category, including built-in ones (only category *deletion* and built-in
// *field* deletion are blocked — see spec: "their fields can be viewed but
// not deleted").
const update = asyncHandler(async (req, res) => {
  const category = await AssetCategory.findByPk(req.params.categoryId);
  if (!category) throw new ApiError(404, 'Category not found', 'NOT_FOUND');

  const changes = {};
  if (req.body.name !== undefined) {
    if (!req.body.name.trim()) throw new ApiError(400, 'Category name is required', 'VALIDATION_ERROR');
    const conflict = await AssetCategory.findOne({ where: { name: req.body.name.trim(), id: { [Op.ne]: category.id } } });
    if (conflict) throw new ApiError(409, 'A category with this name already exists', 'DUPLICATE_NAME');
    changes.name = req.body.name.trim();
  }
  if (req.body.icon !== undefined) changes.icon = req.body.icon || null;
  if (req.body.color !== undefined) changes.color = req.body.color || null;

  await category.update(changes);
  await writeAudit(req, 'assetCategory.update', 'AssetCategory', category.id, changes);
  const fresh = await AssetCategory.findByPk(category.id, { include: [{ model: AssetCategoryField, as: 'fields' }] });
  res.json({ category: fresh });
});

// DELETE /assets/categories/:categoryId — refused for built-in categories,
// and for any category still in use (Assets.categoryId is NOT NULL, so
// deleting would either orphan or fail at the DB level either way).
const remove = asyncHandler(async (req, res) => {
  const category = await AssetCategory.findByPk(req.params.categoryId);
  if (!category) throw new ApiError(404, 'Category not found', 'NOT_FOUND');
  if (category.isBuiltIn) throw new ApiError(400, 'Built-in categories cannot be deleted', 'BUILT_IN_CATEGORY');

  const assetCount = await Asset.count({ where: { categoryId: category.id } });
  if (assetCount > 0) {
    throw new ApiError(409, `${assetCount} asset${assetCount === 1 ? ' uses' : 's use'} this category. Reassign or delete them first.`, 'CATEGORY_IN_USE');
  }

  await category.destroy();
  await writeAudit(req, 'assetCategory.delete', 'AssetCategory', category.id, { name: category.name });
  res.json({ ok: true });
});

function validateFieldBody(body, existing) {
  const out = {};
  const label = body.label !== undefined ? body.label : existing?.label;
  if (!label || !String(label).trim()) throw new ApiError(400, 'Field label is required', 'VALIDATION_ERROR');
  if (body.label !== undefined) out.label = label.trim();

  const fieldType = body.fieldType !== undefined ? body.fieldType : (existing?.fieldType || 'text');
  if (!FIELD_TYPES.includes(fieldType)) throw new ApiError(400, 'Invalid field type', 'VALIDATION_ERROR');
  if (body.fieldType !== undefined || !existing) out.fieldType = fieldType;

  if (fieldType === 'dropdown') {
    if (body.options !== undefined || !existing) {
      const options = Array.isArray(body.options) ? body.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (options.length < 2) throw new ApiError(400, 'Dropdown fields need at least 2 options', 'VALIDATION_ERROR');
      out.options = options;
    }
  } else if (body.fieldType !== undefined) {
    out.options = null;
  }

  if (body.required !== undefined) out.required = !!body.required;
  return out;
}

// GET /assets/categories/:categoryId/fields
const listFields = asyncHandler(async (req, res) => {
  const fields = await AssetCategoryField.findAll({ where: { categoryId: req.params.categoryId }, order: [['position', 'ASC'], ['id', 'ASC']] });
  res.json({ fields });
});

// POST /assets/categories/:categoryId/fields — allowed for built-in
// categories too (admins can extend them with more fields).
const createField = asyncHandler(async (req, res) => {
  const category = await AssetCategory.findByPk(req.params.categoryId);
  if (!category) throw new ApiError(404, 'Category not found', 'NOT_FOUND');

  const data = validateFieldBody(req.body || {});
  let fieldKey = req.body.fieldKey ? String(req.body.fieldKey).trim() : '';
  if (fieldKey) {
    if (!FIELD_KEY_RE.test(fieldKey)) throw new ApiError(400, 'Field key may only contain letters, numbers, and underscores', 'VALIDATION_ERROR');
    const conflict = await AssetCategoryField.findOne({ where: { categoryId: category.id, fieldKey } });
    if (conflict) throw new ApiError(409, 'A field with this key already exists on this category', 'FIELD_KEY_TAKEN');
  } else {
    fieldKey = await uniqueFieldKey(category.id, slugify(data.label));
  }

  const maxPosition = await AssetCategoryField.max('position', { where: { categoryId: category.id } });
  const field = await AssetCategoryField.create({
    categoryId: category.id, fieldKey, ...data, isBuiltIn: false, position: (maxPosition || 0) + 1,
  });
  await writeAudit(req, 'assetCategoryField.create', 'AssetCategoryField', field.id, { categoryId: category.id, label: field.label });
  res.status(201).json({ field });
});

// PATCH /assets/categories/:categoryId/fields/:fieldId — label/type/
// options/required editable on any field, including built-in ones (only
// deletion is blocked for those — see remove() below).
const updateField = asyncHandler(async (req, res) => {
  const field = await AssetCategoryField.findOne({ where: { id: req.params.fieldId, categoryId: req.params.categoryId } });
  if (!field) throw new ApiError(404, 'Field not found', 'NOT_FOUND');

  const data = validateFieldBody(req.body || {}, field);
  await field.update(data);
  await writeAudit(req, 'assetCategoryField.update', 'AssetCategoryField', field.id, data);
  res.json({ field });
});

// DELETE /assets/categories/:categoryId/fields/:fieldId — blocked for
// built-in fields; warns (409) if any asset has a value for it, unless
// ?force=true.
const removeField = asyncHandler(async (req, res) => {
  const field = await AssetCategoryField.findOne({ where: { id: req.params.fieldId, categoryId: req.params.categoryId } });
  if (!field) throw new ApiError(404, 'Field not found', 'NOT_FOUND');
  if (field.isBuiltIn) throw new ApiError(400, 'Built-in fields cannot be deleted', 'BUILT_IN_FIELD');

  if (req.query.force !== 'true') {
    const valueCount = await AssetFieldValue.count({ where: { fieldId: field.id } });
    if (valueCount > 0) {
      throw new ApiError(409, `${valueCount} asset${valueCount === 1 ? ' has a value' : 's have values'} for "${field.label}". Delete anyway?`, 'HAS_VALUES');
    }
  }

  await field.destroy();
  await writeAudit(req, 'assetCategoryField.delete', 'AssetCategoryField', field.id, { label: field.label });
  res.json({ ok: true });
});

// PATCH /assets/categories/:categoryId/fields/reorder — Body: { order: [id, ...] }
const reorderFields = asyncHandler(async (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order.map((v) => parseInt(v, 10)).filter(Boolean) : [];
  if (!order.length) throw new ApiError(400, 'order must be a non-empty array of field ids', 'VALIDATION_ERROR');

  const fields = await AssetCategoryField.findAll({ where: { id: order, categoryId: req.params.categoryId } });
  if (fields.length !== order.length) throw new ApiError(400, 'One or more fields do not exist on this category', 'VALIDATION_ERROR');

  await Promise.all(order.map((id, idx) => AssetCategoryField.update({ position: idx + 1 }, { where: { id } })));
  res.json({ ok: true });
});

module.exports = { list, get, create, update, remove, listFields, createField, updateField, removeField, reorderFields };
