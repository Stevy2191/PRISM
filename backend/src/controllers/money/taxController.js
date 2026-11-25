// Tax rates and tax categories (Phase 3, step 1). Changing them needs
// money.settings; customers' invoices read them.
const { Op, fn, col } = require('sequelize');
const { TaxRate, TaxCategory, sequelize } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId } = require('../../services/permissionService');
const { unit } = require('../../services/money/money');

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

function name(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) throw bad('A name is required');
  if (s.length > 100) throw bad('The name is too long');
  return s;
}
// A percentage 0–100 with up to 4 decimals.
function pct(raw, label) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s) || Number(s) > 100) throw bad(`${label} must be a percentage from 0 to 100`);
  return s;
}
const bool = (raw, label) => {
  if (typeof raw !== 'boolean') throw bad(`${label} must be true or false`);
  return raw;
};
const rateJson = (r) => ({ ...r.get({ plain: true }), ratePercent: unit(r.ratePercent) });
const catJson = (c) => ({ ...c.get({ plain: true }), taxablePercent: unit(c.taxablePercent) });

// GET /money/tax-rates
const listRates = asyncHandler(async (req, res) => {
  res.json({ taxRates: (await TaxRate.findAll({ order: [['isDefault', 'DESC'], ['name', 'ASC']] })).map(rateJson) });
});

async function saveRate(req, rate) {
  const body = req.body || {};
  const fields = {};
  if (!rate || body.name !== undefined) fields.name = name(body.name);
  if (!rate || body.ratePercent !== undefined) fields.ratePercent = pct(body.ratePercent, 'The rate');
  if (body.active !== undefined) fields.active = bool(body.active, 'Active');
  const makeDefault = body.isDefault === undefined ? undefined : bool(body.isDefault, 'Default');
  return sequelize.transaction(async (transaction) => {
    // One default at a time.
    if (makeDefault) await TaxRate.update({ isDefault: false }, { where: { isDefault: true }, transaction });
    if (makeDefault !== undefined) fields.isDefault = makeDefault;
    const saved = rate ? await rate.update(fields, { transaction }) : await TaxRate.create(fields, { transaction });
    return saved;
  });
}

// POST /money/tax-rates { name, ratePercent, isDefault? }
const createRate = asyncHandler(async (req, res) => {
  const rate = await saveRate(req, null);
  await writeAudit(req, 'money.taxRate.create', 'TaxRate', rate.id, { name: rate.name, ratePercent: rate.ratePercent });
  res.status(201).json({ taxRate: rateJson(rate) });
});

// PATCH /money/tax-rates/:id
const updateRate = asyncHandler(async (req, res) => {
  const rate = await TaxRate.findByPk(parseRecordId(req.params.id) || 0);
  if (!rate) throw new ApiError(404, 'Tax rate not found', 'NOT_FOUND');
  const saved = await saveRate(req, rate);
  await writeAudit(req, 'money.taxRate.update', 'TaxRate', rate.id, req.body || {});
  res.json({ taxRate: rateJson(saved) });
});

// GET /money/tax-categories
const listCategories = asyncHandler(async (req, res) => {
  res.json({ taxCategories: (await TaxCategory.findAll({ order: [['name', 'ASC']] })).map(catJson) });
});

async function assertCategoryNameFree(value, excludeId) {
  const clash = await TaxCategory.findOne({
    where: { [Op.and]: [sequelize.where(fn('LOWER', col('name')), value.toLowerCase())], ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
  });
  if (clash) throw new ApiError(409, 'There is already a tax category with that name', 'NAME_TAKEN');
}

// POST /money/tax-categories { name, taxablePercent }
const createCategory = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fields = { name: name(body.name), taxablePercent: pct(body.taxablePercent, 'The taxable share') };
  await assertCategoryNameFree(fields.name);
  const made = await TaxCategory.create(fields);
  await writeAudit(req, 'money.taxCategory.create', 'TaxCategory', made.id, fields);
  res.status(201).json({ taxCategory: catJson(made) });
});

// PATCH /money/tax-categories/:id { name?, taxablePercent?, active? }
const updateCategory = asyncHandler(async (req, res) => {
  const cat = await TaxCategory.findByPk(parseRecordId(req.params.id) || 0);
  if (!cat) throw new ApiError(404, 'Tax category not found', 'NOT_FOUND');
  const body = req.body || {};
  const fields = {};
  if (body.name !== undefined) {
    fields.name = name(body.name);
    await assertCategoryNameFree(fields.name, cat.id);
  }
  if (body.taxablePercent !== undefined) fields.taxablePercent = pct(body.taxablePercent, 'The taxable share');
  if (body.active !== undefined) fields.active = bool(body.active, 'Active');
  await cat.update(fields);
  await writeAudit(req, 'money.taxCategory.update', 'TaxCategory', cat.id, fields);
  res.json({ taxCategory: catJson(cat) });
});

module.exports = {
  listRates, createRate, updateRate, listCategories, createCategory, updateCategory,
};
