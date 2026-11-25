// Products and services (Phase 3, step 1). Seen by those who bill or buy;
// changed with money.rates.manage.
const { Op, fn, col } = require('sequelize');
const { CatalogProduct, TaxCategory, sequelize } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId } = require('../../services/permissionService');
const { escapeLike } = require('../../utils/escapeLike');
const { unit } = require('../../services/money/money');
const { unitPrice, usageCost } = require('../../services/money/catalog');
const { moneyConfig } = require('../../services/money/config');

const KINDS = ['labor', 'service', 'product', 'license', 'fee'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

function text(raw, label, max, required = false) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s || null;
}
function decimal(raw, label, { allowNull = true, positive = false } = {}) {
  if (raw === null || raw === '') {
    if (!allowNull) throw bad(`${label} is required`);
    return null;
  }
  const s = String(raw).trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s)) throw bad(`${label} must be a number of 0 or more (up to 4 decimals)`);
  if (positive && Number(s) <= 0) throw bad(`${label} must be more than 0`);
  return s;
}
const bool = (raw, label) => {
  if (typeof raw !== 'boolean') throw bad(`${label} must be true or false`);
  return raw;
};

async function readFields(body, isCreate) {
  const out = {};
  if (isCreate || body.name !== undefined) out.name = text(body.name, 'Name', 255, true);
  if (body.sku !== undefined) out.sku = text(body.sku, 'SKU', 100);
  if (isCreate || body.kind !== undefined) {
    if (!KINDS.includes(body.kind)) throw bad(`Kind must be one of: ${KINDS.join(', ')}`);
    out.kind = body.kind;
  }
  if (body.unit !== undefined) out.unit = text(body.unit, 'Unit', 20) || 'each';
  if (body.cost !== undefined) out.cost = decimal(body.cost, 'Cost');
  if (body.price !== undefined) out.price = decimal(body.price, 'Price');
  if (body.markupPercent !== undefined) out.markupPercent = decimal(body.markupPercent, 'Markup');
  if (body.purchaseUnit !== undefined) out.purchaseUnit = text(body.purchaseUnit, 'Purchase unit', 20);
  if (body.usagePerPurchase !== undefined) out.usagePerPurchase = decimal(body.usagePerPurchase, 'Units per purchase', { allowNull: false, positive: true });
  for (const key of ['stocked', 'serialized', 'active']) if (body[key] !== undefined) out[key] = bool(body[key], key);
  if (body.notes !== undefined) out.notes = text(body.notes, 'Notes', 5000);
  if (body.taxCategoryId !== undefined) {
    if (body.taxCategoryId === null) out.taxCategoryId = null;
    else {
      const cat = await TaxCategory.findByPk(parseRecordId(body.taxCategoryId) || 0);
      if (!cat) throw bad('Tax category not found');
      out.taxCategoryId = cat.id;
    }
  }
  return out;
}

async function assertUnique(fields, excludeId) {
  const not = excludeId ? { id: { [Op.ne]: excludeId } } : {};
  if (fields.name && await CatalogProduct.findOne({ where: { ...not, [Op.and]: [sequelize.where(fn('LOWER', col('name')), fields.name.toLowerCase())] } })) {
    throw new ApiError(409, 'There is already a product with that name', 'NAME_TAKEN');
  }
  if (fields.sku && await CatalogProduct.findOne({ where: { ...not, [Op.and]: [sequelize.where(fn('LOWER', col('sku')), fields.sku.toLowerCase())] } })) {
    throw new ApiError(409, 'There is already a product with that SKU', 'SKU_TAKEN');
  }
}

function productJson(p, cfg) {
  const plain = p.get({ plain: true });
  return {
    ...plain,
    cost: plain.cost == null ? null : unit(plain.cost),
    price: plain.price == null ? null : unit(plain.price),
    markupPercent: plain.markupPercent == null ? null : unit(plain.markupPercent),
    usagePerPurchase: unit(plain.usagePerPurchase == null ? 1 : plain.usagePerPurchase),
    usageCost: usageCost(plain),
    unitPrice: unitPrice(plain, cfg),
  };
}

// GET /money/products?search=&kind=&active=
const list = asyncHandler(async (req, res) => {
  const where = {};
  if (KINDS.includes(req.query.kind)) where.kind = req.query.kind;
  if (req.query.active === 'true') where.active = true;
  const search = String(req.query.search || '').trim().slice(0, 100);
  if (search) where[Op.or] = [{ name: { [Op.like]: `%${escapeLike(search)}%` } }, { sku: { [Op.like]: `%${escapeLike(search)}%` } }];
  const [rows, cfg] = await Promise.all([CatalogProduct.findAll({ where, order: [['name', 'ASC']], limit: 500 }), moneyConfig()]);
  res.json({ products: rows.map((p) => productJson(p, cfg)) });
});

// POST /money/products
const create = asyncHandler(async (req, res) => {
  const fields = await readFields(req.body || {}, true);
  await assertUnique(fields);
  const p = await CatalogProduct.create(fields);
  await writeAudit(req, 'money.product.create', 'CatalogProduct', p.id, { name: p.name, kind: p.kind });
  res.status(201).json({ product: productJson(p, await moneyConfig()) });
});

// PATCH /money/products/:id
const update = asyncHandler(async (req, res) => {
  const p = await CatalogProduct.findByPk(parseRecordId(req.params.id) || 0);
  if (!p) throw new ApiError(404, 'Product not found', 'NOT_FOUND');
  const fields = await readFields(req.body || {}, false);
  await assertUnique(fields, p.id);
  await p.update(fields);
  await writeAudit(req, 'money.product.update', 'CatalogProduct', p.id, fields);
  res.json({ product: productJson(p, await moneyConfig()) });
});

module.exports = { list, create, update };
