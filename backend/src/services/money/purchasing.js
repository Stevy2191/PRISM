// Purchase orders (Phase 3, step 2). Ordered for a job or for the shelf;
// received in full or in part. Receiving a line:
//   - a shelf line goes on the shelf (in usage units);
//   - a job line becomes the job's material (in usage units, at the
//     catalog's price), and a serialized product becomes an asset in the
//     job's company, one per unit, with its serial number.
// Costs reach the books with the supplier's bill, not on receipt.
const {
  PurchaseOrder, PurchaseOrderLine, CatalogProduct, Company, Asset, AssetCategory, Ticket, Project, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId, findAccessibleTicket, findAccessibleProject } = require('../permissionService');
const { suggestNextAssetTag } = require('../assetTagService');
const { D, unit, cents } = require('./money');
const stock = require('./stock');
const { addMaterial } = require('./materials');
const { findTicketIdByNumber } = require('../tickets/numbers');

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const conflict = (message) => new ApiError(409, message, 'PO_STATE');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const qtyOf = (raw, label) => {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s) || D(s).isZero()) throw bad(`${label} must be a number over 0`);
  return s;
};

const include = [
  { model: PurchaseOrderLine, as: 'lines', include: [{ model: CatalogProduct, as: 'product', attributes: ['id', 'name', 'unit', 'purchaseUnit', 'serialized', 'stocked'] }] },
  { model: Company, as: 'vendor', attributes: ['id', 'name'] },
];
const load = (id, options = {}) => PurchaseOrder.findByPk(id, { include, order: [[{ model: PurchaseOrderLine, as: 'lines' }, 'id', 'ASC']], ...options });

async function nextNumber(transaction) {
  const [[row]] = await sequelize.query("SELECT MAX(CAST(SUBSTRING(number, 4) AS UNSIGNED)) AS n FROM PurchaseOrders WHERE number LIKE 'PO-%' FOR UPDATE", { transaction });
  return `PO-${String((Number(row && row.n) || 0) + 1).padStart(5, '0')}`;
}

// POST { vendorCompanyId, ticketId? | projectId?, notes?, lines: [{ catalogProductId?, description?, quantity, unitCost, forStock? }] }
async function createPurchaseOrder(input, user) {
  const vendor = await Company.findByPk(parseRecordId(input.vendorCompanyId) || 0);
  if (!vendor || !vendor.isVendor) throw bad('Choose a vendor');
  if (input.ticketId && input.projectId) throw bad('A purchase order is for a ticket or a project, not both');
  let ticketId = null;
  let projectId = null;
  if (input.ticketId) {
    const t = await findAccessibleTicket(user, (await findTicketIdByNumber(input.ticketId)) || 0); // WC-T0042 or its id
    if (!t) throw bad('Ticket not found');
    ticketId = t.id;
  }
  if (input.projectId) {
    const p = await findAccessibleProject(user, parseRecordId(input.projectId) || 0);
    if (!p) throw bad('Project not found');
    projectId = p.id;
  }
  if (!Array.isArray(input.lines) || !input.lines.length) throw bad('A purchase order needs at least one line');
  if (input.lines.length > 200) throw bad('A purchase order can have at most 200 lines');
  const lines = [];
  for (const [i, l] of input.lines.entries()) {
    const n = `Line ${i + 1}`;
    let product = null;
    if (l.catalogProductId) {
      product = await CatalogProduct.findByPk(parseRecordId(l.catalogProductId) || 0); // eslint-disable-line no-await-in-loop
      if (!product) throw bad(`${n}: product not found`);
    }
    const description = String(l.description || (product && product.name) || '').trim();
    if (!description) throw bad(`${n}: what is it?`);
    const forStock = l.forStock === true;
    if (forStock && !(product && product.stocked)) throw bad(`${n}: only a stocked product goes on the shelf`);
    if (!forStock && !ticketId && !projectId) throw bad(`${n}: this purchase order isn't for a job, so its items must go on the shelf`);
    const unitCost = String(l.unitCost ?? (product && product.cost) ?? '0').trim();
    if (!/^\d{1,8}(\.\d{1,4})?$/.test(unitCost)) throw bad(`${n}: the unit cost must be an amount of 0 or more`);
    lines.push({
      catalogProductId: product ? product.id : null, description: description.slice(0, 500), quantity: unit(qtyOf(l.quantity, `${n}'s quantity`)), unitCost: unit(unitCost), forStock,
    });
  }
  const po = await sequelize.transaction(async (transaction) => {
    const made = await PurchaseOrder.create({
      number: await nextNumber(transaction), vendorCompanyId: vendor.id, ticketId, projectId, notes: input.notes ? String(input.notes).slice(0, 5000) : null, createdBy: user.id,
    }, { transaction });
    await PurchaseOrderLine.bulkCreate(lines.map((l) => ({ ...l, purchaseOrderId: made.id })), { transaction });
    return made;
  });
  return load(po.id);
}

async function setStatus(po, from, to, extra = {}) {
  await sequelize.transaction(async (transaction) => {
    const fresh = await PurchaseOrder.findByPk(po.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!from.includes(fresh.status)) throw conflict(`A ${fresh.status.replace('_', ' ')} purchase order can't be ${to === 'ordered' ? 'ordered' : 'cancelled'}`);
    await fresh.update({ status: to, ...extra }, { transaction });
  });
  return load(po.id);
}
const orderPurchaseOrder = (po, { orderedOn } = {}, today) => setStatus(po, ['draft'], 'ordered', { orderedOn: isDate(orderedOn) ? orderedOn : today });
const cancelPurchaseOrder = (po) => setStatus(po, ['draft', 'ordered', 'partly_received'], 'cancelled');

// receive(po, [{ lineId, quantity, serials? }], { user, receivedOn })
async function receive(po, rawLines, { user, receivedOn }) {
  if (!['ordered', 'partly_received'].includes(po.status)) throw conflict(`A ${po.status.replace('_', ' ')} purchase order can't be received`);
  if (!Array.isArray(rawLines) || !rawLines.length) throw bad('Say what arrived');
  const result = { materials: [], assets: [], stock: [] };
  await sequelize.transaction(async (transaction) => {
    const fresh = await PurchaseOrder.findByPk(po.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!['ordered', 'partly_received'].includes(fresh.status)) throw conflict(`A ${fresh.status} purchase order can't be received`);
    const job = fresh.ticketId
      ? { kind: 'ticket', record: await Ticket.findByPk(fresh.ticketId, { transaction }) }
      : (fresh.projectId ? { kind: 'project', record: await Project.findByPk(fresh.projectId, { transaction }) } : null);
    for (const r of rawLines) {
      /* eslint-disable no-await-in-loop */
      const line = await PurchaseOrderLine.findOne({ where: { id: parseRecordId(r.lineId) || 0, purchaseOrderId: fresh.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!line) throw bad('That line is not on this purchase order');
      const qty = qtyOf(r.quantity, 'The quantity received');
      const after = D(line.receivedQuantity).plus(qty);
      if (after.greaterThan(D(line.quantity))) throw bad(`More ${line.description} than was ordered`);
      const product = line.catalogProductId ? await CatalogProduct.findByPk(line.catalogProductId, { transaction }) : null;
      const usageQty = unit(D(qty).times(D(product ? product.usagePerPurchase : 1)));
      const usageCost = product ? unit(D(line.unitCost).div(D(product.usagePerPurchase || 1))) : unit(line.unitCost);
      if (line.forStock) {
        result.stock.push(await stock.stockIn(product, usageQty, {
          unitCost: usageCost, poLineId: line.id, transaction, userId: user.id,
        }));
      } else {
        // A job line whose ticket or project was deleted has nowhere to go.
        if (!job || !job.record) throw conflict('This purchase order\'s ticket or project no longer exists; receive its items onto the shelf another way');
        const serials = Array.isArray(r.serials) ? r.serials.map((x) => String(x).trim()).filter(Boolean) : [];
        if (product && product.serialized) {
          if (!D(qty).isInteger() || serials.length !== Number(qty)) throw bad(`${line.description} needs one serial number for each received`);
          const category = (product.assetCategoryId && await AssetCategory.findByPk(product.assetCategoryId, { transaction }))
            || await AssetCategory.findOne({ where: { name: 'Computers' }, transaction });
          for (const serialNumber of serials) {
            result.assets.push(await Asset.create({
              assetTag: await suggestNextAssetTag(category, { transaction }),
              name: product.name,
              categoryId: category.id,
              companyId: job.record.companyId,
              serialNumber: serialNumber.slice(0, 150),
              purchaseDate: isDate(receivedOn) ? receivedOn : null,
              purchasePrice: cents(line.unitCost),
              vendorCompanyId: fresh.vendorCompanyId,
            }, { transaction }));
          }
        }
        result.materials.push(await addMaterial(job, {
          catalogProductId: product ? product.id : undefined,
          itemName: product ? undefined : line.description,
          quantity: usageQty,
          unitCost: usageCost,
          serialNumber: serials,
        }, {
          user, transaction, pricesAllowed: true, poLineId: line.id,
        }));
      }
      await line.update({ receivedQuantity: unit(after) }, { transaction });
      /* eslint-enable no-await-in-loop */
    }
    const lines = await PurchaseOrderLine.findAll({ where: { purchaseOrderId: fresh.id }, transaction });
    const all = lines.every((l) => D(l.receivedQuantity).greaterThanOrEqualTo(D(l.quantity)));
    await fresh.update({ status: all ? 'received' : 'partly_received' }, { transaction });
  });
  return { purchaseOrder: await load(po.id), ...result };
}

function poJson(po) {
  const plain = po.get({ plain: true });
  return {
    ...plain,
    lines: (plain.lines || []).map((l) => ({
      ...l, quantity: unit(l.quantity), unitCost: unit(l.unitCost), receivedQuantity: unit(l.receivedQuantity), total: cents(D(l.quantity).times(D(l.unitCost))),
    })),
  };
}

module.exports = {
  createPurchaseOrder, orderPurchaseOrder, cancelPurchaseOrder, receive, poJson, load,
};
