// Materials on a job (Phase 3, step 2): a ticket's or a project's, from the
// catalog, the shelf, or typed in. Quantities are in usage units (300 ft).
// Costs and prices are seen and set only by those with money permissions.
const { ProjectMaterial, CatalogProduct, sequelize } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { hasPermission, parseRecordId } = require('../permissionService');
const {
  D, unit, cents,
} = require('./money');
const { unitPrice, usageCost } = require('./catalog');
const { moneyConfig } = require('./config');
const stock = require('./stock');

const MONEY_KEYS = ['money.billing.view', 'money.purchasing.manage', 'money.bills.manage'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

async function canSeePrices(user) {
  for (const key of MONEY_KEYS) {
    if (await hasPermission(user.id, key)) return true; // eslint-disable-line no-await-in-loop
  }
  return false;
}

function quantity(raw) {
  const s = String(raw ?? '1').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s) || D(s).isZero()) throw bad('Quantity must be a number over 0');
  return s;
}
function money4(raw, label) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s)) throw bad(`${label} must be an amount of 0 or more`);
  return s;
}

const jobWhere = (job) => (job.kind === 'ticket' ? { ticketId: job.record.id } : { projectId: job.record.id });

// job: { kind: 'ticket'|'project', record }. Returns the new material.
async function addMaterial(job, input, {
  user, transaction = null, pricesAllowed = false,
} = {}) {
  const qty = quantity(input.quantity);
  if (!pricesAllowed && (input.unitPrice !== undefined || input.unitCost !== undefined)) {
    throw new ApiError(403, 'You need a money permission to set prices', 'FORBIDDEN');
  }
  let product = null;
  if (input.catalogProductId) {
    product = await CatalogProduct.findByPk(parseRecordId(input.catalogProductId) || 0, { transaction });
    if (!product || !product.active) throw bad('Product not found');
  }
  const itemName = product ? product.name : String(input.itemName || '').trim();
  if (!itemName) throw bad('Item name is required');
  if (itemName.length > 255) throw bad('Item name is too long');
  const fromStock = input.fromStock === true;
  if (fromStock && !(product && product.stocked)) throw bad('Only a stocked product comes from the shelf');
  const cfg = product ? await moneyConfig() : null;
  const cost = money4(input.unitCost, 'Unit cost') ?? (product ? usageCost(product) : null);
  const price = money4(input.unitPrice, 'Unit price') ?? (product ? unitPrice(product, cfg) : null);
  const serials = Array.isArray(input.serialNumber) ? input.serialNumber.filter(Boolean).map(String) : (input.serialNumber ? [String(input.serialNumber)] : []);

  const run = async (t) => {
    const material = await ProjectMaterial.create({
      ...jobWhere(job),
      taskId: input.taskId || null,
      itemName,
      catalogProductId: product ? product.id : null,
      quantity: unit(qty),
      unitCost: cost == null ? 0 : cents(cost),
      totalCost: cost == null ? 0 : cents(D(cost).times(qty)),
      unitPrice: price == null ? null : unit(price),
      taxCategoryId: product ? product.taxCategoryId : null,
      billable: input.billable !== false,
      billingStatus: input.billable === false ? 'non_billable' : 'unbilled',
      fromStock,
      serialNumber: serials,
      poLineId: input.poLineId || null,
      notes: input.notes ? String(input.notes).slice(0, 5000) : null,
      addedBy: user.id,
    }, { transaction: t });
    if (fromStock) {
      await stock.stockOut(product, qty, {
        materialId: material.id, companyId: job.record.companyId, transaction: t, userId: user.id,
      });
    }
    return material;
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

// Removing a shelf item puts it back on the shelf.
async function removeMaterial(material, { user }) {
  await sequelize.transaction(async (t) => {
    if (material.fromStock && material.catalogProductId) {
      const product = await CatalogProduct.findByPk(material.catalogProductId, { transaction: t });
      if (product) await stock.stockIn(product, unit(material.quantity), { note: `Returned from ${material.itemName}`, transaction: t, userId: user.id });
    }
    await material.destroy({ transaction: t });
  });
}

function materialJson(m, { canSeePrices: prices }) {
  const plain = m.get ? m.get({ plain: true }) : { ...m };
  const out = { ...plain, quantity: unit(plain.quantity) };
  if (prices) {
    out.unitCost = plain.unitCost == null ? null : unit(plain.unitCost);
    out.totalCost = plain.totalCost == null ? null : cents(plain.totalCost);
    out.unitPrice = plain.unitPrice == null ? null : unit(plain.unitPrice);
    out.totalPrice = plain.unitPrice == null ? null : cents(D(plain.unitPrice).times(D(plain.quantity)));
  } else {
    delete out.unitCost;
    delete out.totalCost;
    delete out.unitPrice;
  }
  return out;
}

module.exports = {
  addMaterial, removeMaterial, materialJson, canSeePrices, quantity,
};
