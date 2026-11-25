// Purchase orders (Phase 3, step 2): money.purchasing.manage.
const { Op } = require('sequelize');
const { PurchaseOrder } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId, findAccessibleTicket, findAccessibleProject } = require('../../services/permissionService');
const { orgToday } = require('../../utils/orgTime');
const purchasing = require('../../services/money/purchasing');

async function findPo(req) {
  const po = await purchasing.load(parseRecordId(req.params.id) || 0);
  if (!po) throw new ApiError(404, 'Purchase order not found', 'NOT_FOUND');
  // A job's PO: the job must be in reach.
  if (po.ticketId && !(await findAccessibleTicket(req.user, po.ticketId))) throw new ApiError(404, 'Purchase order not found', 'NOT_FOUND');
  if (po.projectId && !(await findAccessibleProject(req.user, po.projectId))) throw new ApiError(404, 'Purchase order not found', 'NOT_FOUND');
  return po;
}

// GET /money/purchase-orders?status=&vendorCompanyId=
const list = asyncHandler(async (req, res) => {
  const where = {};
  if (['draft', 'ordered', 'partly_received', 'received', 'cancelled'].includes(req.query.status)) where.status = req.query.status;
  if (req.query.vendorCompanyId) where.vendorCompanyId = parseRecordId(req.query.vendorCompanyId) || -1;
  const rows = await PurchaseOrder.findAll({ where, order: [['id', 'DESC']], limit: 500 });
  const visible = [];
  for (const po of rows) {
    /* eslint-disable no-await-in-loop */
    if (po.ticketId && !(await findAccessibleTicket(req.user, po.ticketId))) continue; // eslint-disable-line no-continue
    if (po.projectId && !(await findAccessibleProject(req.user, po.projectId))) continue; // eslint-disable-line no-continue
    /* eslint-enable no-await-in-loop */
    visible.push(purchasing.poJson(await purchasing.load(po.id))); // eslint-disable-line no-await-in-loop
  }
  res.json({ purchaseOrders: visible });
});

const get = asyncHandler(async (req, res) => res.json({ purchaseOrder: purchasing.poJson(await findPo(req)) }));

const create = asyncHandler(async (req, res) => {
  const po = await purchasing.createPurchaseOrder(req.body || {}, req.user);
  await writeAudit(req, 'money.po.create', 'PurchaseOrder', po.id, { number: po.number, vendorCompanyId: po.vendorCompanyId });
  res.status(201).json({ purchaseOrder: purchasing.poJson(po) });
});

const order = asyncHandler(async (req, res) => {
  const po = await purchasing.orderPurchaseOrder(await findPo(req), req.body || {}, await orgToday());
  await writeAudit(req, 'money.po.order', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ purchaseOrder: purchasing.poJson(po) });
});

const cancel = asyncHandler(async (req, res) => {
  const po = await purchasing.cancelPurchaseOrder(await findPo(req));
  await writeAudit(req, 'money.po.cancel', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ purchaseOrder: purchasing.poJson(po) });
});

// POST /money/purchase-orders/:id/receive { receivedOn?, lines: [{ lineId, quantity, serials? }] }
const receive = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const receivedOn = typeof body.receivedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.receivedOn) ? body.receivedOn : await orgToday();
  const out = await purchasing.receive(await findPo(req), body.lines, { user: req.user, receivedOn });
  await writeAudit(req, 'money.po.receive', 'PurchaseOrder', out.purchaseOrder.id, { lines: body.lines });
  res.json({
    purchaseOrder: purchasing.poJson(out.purchaseOrder), assets: out.assets.map((x) => ({ id: x.id, assetTag: x.assetTag, serialNumber: x.serialNumber })),
  });
});

// GET /tickets/:id/purchase-orders and /projects/:id/purchase-orders
function forJob(kind) {
  return asyncHandler(async (req, res) => {
    const id = parseRecordId(req.params.id) || 0;
    const job = kind === 'ticket' ? await findAccessibleTicket(req.user, id) : await findAccessibleProject(req.user, id);
    if (!job) throw new ApiError(404, `${kind === 'ticket' ? 'Ticket' : 'Project'} not found`, 'NOT_FOUND');
    const rows = await PurchaseOrder.findAll({ where: { [kind === 'ticket' ? 'ticketId' : 'projectId']: job.id, status: { [Op.ne]: 'cancelled' } }, order: [['id', 'DESC']] });
    const out = [];
    for (const po of rows) out.push(purchasing.poJson(await purchasing.load(po.id))); // eslint-disable-line no-await-in-loop
    res.json({ purchaseOrders: out });
  });
}

module.exports = {
  list, get, create, order, cancel, receive, ticketPurchaseOrders: forJob('ticket'), projectPurchaseOrders: forJob('project'),
};
