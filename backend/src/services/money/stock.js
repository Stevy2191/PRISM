// Shelf stock (Phase 3, step 2): kept in usage units (feet, not boxes).
// Receiving adds (its cost reaches the books with the supplier's bill);
// using takes off and posts the cost (Dr Cost of materials / Cr Inventory);
// a count adjusts and posts the difference. Never more out than is on hand.
const {
  CatalogProduct, StockMovement, Notification, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { D, unit, cents } = require('./money');
const { usageCost } = require('./catalog');
const ledger = require('./ledger');
const { orgToday } = require('../../utils/orgTime');

function quantity(raw, label = 'The quantity') {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s) || D(s).isZero()) throw new ApiError(400, `${label} must be a number over 0`, 'VALIDATION_ERROR');
  return s;
}

// Runs fn(product locked, transaction) in the caller's transaction or a new one.
async function withLockedProduct(product, transaction, fn) {
  const run = async (t) => {
    const locked = await CatalogProduct.findByPk(product.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!locked) throw new ApiError(404, 'Product not found', 'NOT_FOUND');
    return fn(locked, t);
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

// Warns those who buy when a use takes it to (or below) its low level.
async function warnIfLow(product, before, after) {
  if (product.lowStockAt == null) return;
  const low = D(product.lowStockAt);
  if (D(before).greaterThan(low) && !D(after).greaterThan(low)) {
    const { activeUserIdsWithPermission } = require('../permissionService'); // eslint-disable-line global-require
    const message = `${product.name} is low: ${unit(after).replace(/\.?0+$/, '')} ${product.unit} left`;
    for (const userId of await activeUserIdsWithPermission('money.purchasing.manage')) {
      await Notification.create({ userId, type: 'stock_low', message }); // eslint-disable-line no-await-in-loop
    }
  }
}

async function stockIn(product, usageQuantity, {
  unitCost = null, poLineId = null, note = null, transaction = null, userId = null,
} = {}) {
  const qty = quantity(usageQuantity);
  return withLockedProduct(product, transaction, async (p, t) => {
    await p.update({ onHand: unit(D(p.onHand).plus(qty)) }, { transaction: t });
    return StockMovement.create({
      productId: p.id, quantity: unit(qty), reason: 'receive', unitCost: unitCost ?? usageCost(p), poLineId, note, createdBy: userId,
    }, { transaction: t });
  });
}

async function stockOut(product, usageQuantity, {
  materialId = null, companyId = null, transaction = null, userId = null,
} = {}) {
  const qty = quantity(usageQuantity);
  let warn = null;
  const movement = await withLockedProduct(product, transaction, async (p, t) => {
    const before = D(p.onHand);
    if (before.lessThan(qty)) {
      throw new ApiError(409, `Only ${unit(before).replace(/\.?0+$/, '') || '0'} ${p.unit} of ${p.name} on hand`, 'NOT_ENOUGH_STOCK');
    }
    const after = before.minus(qty);
    await p.update({ onHand: unit(after) }, { transaction: t });
    const cost = cents(D(usageCost(p) || 0).times(qty));
    const entry = D(cost).isZero() ? null : await ledger.postEntry({
      date: await orgToday(),
      memo: `${unit(qty).replace(/\.?0+$/, '')} ${p.unit} of ${p.name} used`,
      sourceType: 'stock_use',
      sourceId: p.id,
      companyId,
      lines: [{ account: '5000', debit: cost }, { account: '1200', credit: cost }],
    }, { transaction: t, userId });
    warn = () => warnIfLow(p, before, after);
    return StockMovement.create({
      productId: p.id, quantity: unit(D(qty).negated()), reason: 'use', unitCost: usageCost(p), materialId, ledgerEntryId: entry ? entry.id : null, createdBy: userId,
    }, { transaction: t });
  });
  // After the work commits; a warning never fails the use.
  if (warn) {
    if (transaction) transaction.afterCommit(() => warn().catch(() => {}));
    else await warn().catch(() => {});
  }
  return movement;
}

// A count: sets on hand to `newOnHand`, posting the difference at cost
// (down: Dr Other expenses / Cr Inventory; up: the reverse).
async function adjustStock(product, newOnHand, { note = null, userId = null } = {}) {
  const s = String(newOnHand ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s)) throw new ApiError(400, 'On hand must be a number of 0 or more', 'VALIDATION_ERROR');
  return withLockedProduct(product, null, async (p, t) => {
    const diff = D(s).minus(D(p.onHand));
    if (diff.isZero()) return null;
    await p.update({ onHand: unit(s) }, { transaction: t });
    const value = cents(D(usageCost(p) || 0).times(diff.abs()));
    const down = diff.isNegative();
    const entry = D(value).isZero() ? null : await ledger.postEntry({
      date: await orgToday(),
      memo: `${p.name} counted: ${down ? '' : '+'}${unit(diff).replace(/\.?0+$/, '')} ${p.unit}`,
      sourceType: 'stock_adjust',
      sourceId: p.id,
      lines: down
        ? [{ account: '6900', debit: value }, { account: '1200', credit: value }]
        : [{ account: '1200', debit: value }, { account: '6900', credit: value }],
    }, { transaction: t, userId });
    return StockMovement.create({
      productId: p.id, quantity: unit(diff), reason: 'adjust', unitCost: usageCost(p), note, ledgerEntryId: entry ? entry.id : null, createdBy: userId,
    }, { transaction: t });
  });
}

module.exports = {
  stockIn, stockOut, adjustStock, quantity,
};
