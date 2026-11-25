// Shelf stock (Phase 3, step 2): money.purchasing.manage.
const { CatalogProduct, StockMovement } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId } = require('../../services/permissionService');
const { D, unit, cents } = require('../../services/money/money');
const { usageCost } = require('../../services/money/catalog');
const stock = require('../../services/money/stock');

async function findStocked(req) {
  const p = await CatalogProduct.findByPk(parseRecordId(req.params.productId) || 0);
  if (!p || !p.stocked) throw new ApiError(404, 'Stock item not found', 'NOT_FOUND');
  return p;
}

const itemJson = (p) => ({
  productId: p.id,
  name: p.name,
  unit: p.unit,
  onHand: unit(p.onHand),
  value: cents(D(usageCost(p) || 0).times(D(p.onHand))),
  lowStockAt: p.lowStockAt == null ? null : unit(p.lowStockAt),
  low: p.lowStockAt != null && !D(p.onHand).greaterThan(D(p.lowStockAt)),
});

// GET /money/stock
const list = asyncHandler(async (req, res) => {
  const rows = await CatalogProduct.findAll({ where: { stocked: true }, order: [['name', 'ASC']] });
  res.json({ items: rows.map(itemJson) });
});

// GET /money/stock/:productId/movements
const movements = asyncHandler(async (req, res) => {
  const p = await findStocked(req);
  const rows = await StockMovement.findAll({ where: { productId: p.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 200 });
  res.json({ movements: rows.map((m) => ({ ...m.get({ plain: true }), quantity: unit(m.quantity) })) });
});

// POST /money/stock/:productId/adjust { onHand, note? }
const adjust = asyncHandler(async (req, res) => {
  const p = await findStocked(req);
  const body = req.body || {};
  const note = body.note ? String(body.note).trim().slice(0, 255) : null;
  await stock.adjustStock(p, body.onHand, { note, userId: req.user.id });
  await writeAudit(req, 'money.stock.adjust', 'CatalogProduct', p.id, { onHand: body.onHand, note });
  res.json({ item: itemJson(await CatalogProduct.findByPk(p.id)) });
});

// PATCH /money/stock/:productId { lowStockAt }
const update = asyncHandler(async (req, res) => {
  const p = await findStocked(req);
  const raw = (req.body || {}).lowStockAt;
  if (raw !== null && raw !== '' && !/^\d{1,8}(\.\d{1,4})?$/.test(String(raw ?? ''))) {
    throw new ApiError(400, 'The low level must be a number of 0 or more', 'VALIDATION_ERROR');
  }
  await p.update({ lowStockAt: raw === null || raw === '' ? null : String(raw) });
  res.json({ item: itemJson(p) });
});

module.exports = {
  list, movements, adjust, update,
};
