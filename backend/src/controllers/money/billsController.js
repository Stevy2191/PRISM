// Bills (Phase 3, step 2): /money/bills (money.bills.manage), and a job's
// bills on its ticket or project (anyone who sees the job; amounts only for
// those with money permissions).
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { Bill, BillLine, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const {
  parseRecordId, hasPermission, findAccessibleTicket, findAccessibleProject,
} = require('../../services/permissionService');
const { escapeLike } = require('../../utils/escapeLike');
const { orgToday } = require('../../utils/orgTime');
const bills = require('../../services/money/bills');

const FILE_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const notFound = () => new ApiError(404, 'Bill not found', 'NOT_FOUND');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function canSeeAmounts(user) {
  for (const key of ['money.bills.manage', 'money.billing.view', 'money.books.view']) {
    if (await hasPermission(user.id, key)) return true; // eslint-disable-line no-await-in-loop
  }
  return false;
}

async function findBill(req) {
  const bill = await bills.load(parseRecordId(req.params.id) || 0);
  if (!bill) throw notFound();
  return bill;
}

// GET /money/bills?vendorCompanyId=&status=&ticketId=&projectId=&from=&to=&search=
const list = asyncHandler(async (req, res) => {
  const where = {};
  const q = req.query;
  if (q.vendorCompanyId) where.vendorCompanyId = parseRecordId(q.vendorCompanyId) || -1;
  if (['received', 'entered', 'paid', 'void'].includes(q.status)) where.status = q.status;
  if (isDate(q.from) || isDate(q.to)) where.billDate = { ...(isDate(q.from) ? { [Op.gte]: q.from } : {}), ...(isDate(q.to) ? { [Op.lte]: q.to } : {}) };
  const search = String(q.search || '').trim().slice(0, 100);
  if (search) where[Op.or] = [{ billNumber: { [Op.like]: `%${escapeLike(search)}%` } }, { externalRef: { [Op.like]: `%${escapeLike(search)}%` } }];
  const lineWhere = {};
  if (q.ticketId) lineWhere.ticketId = parseRecordId(q.ticketId) || -1;
  if (q.projectId) lineWhere.projectId = parseRecordId(q.projectId) || -1;
  const rows = await Bill.findAll({
    where,
    include: [
      { model: BillLine, as: 'lines', ...(Object.keys(lineWhere).length ? { where: lineWhere, required: true } : {}) },
      { model: Company, as: 'vendor', attributes: ['id', 'name', 'is1099'] },
    ],
    order: [['billDate', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  res.json({ bills: rows.map((b) => bills.billJson(b)) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ bill: bills.billJson(await findBill(req)) });
});

const create = asyncHandler(async (req, res) => {
  const bill = await bills.createBill(req.body || {}, req.user);
  await writeAudit(req, 'money.bill.create', 'Bill', bill.id, { vendorCompanyId: bill.vendorCompanyId, billNumber: bill.billNumber, total: bill.total });
  res.status(201).json({ bill: bills.billJson(bill) });
});

const update = asyncHandler(async (req, res) => {
  const bill = await bills.updateBill(await findBill(req), req.body || {}, req.user);
  await writeAudit(req, 'money.bill.update', 'Bill', bill.id, { fields: Object.keys(req.body || {}) });
  res.json({ bill: bills.billJson(bill) });
});

const enter = asyncHandler(async (req, res) => {
  const bill = await bills.enterBill(await findBill(req), { externalRef: (req.body || {}).externalRef }, req.user);
  await writeAudit(req, 'money.bill.enter', 'Bill', bill.id, { externalRef: bill.externalRef });
  res.json({ bill: bills.billJson(bill) });
});

const pay = asyncHandler(async (req, res) => {
  const bill = await bills.payBill(await findBill(req), req.body || {}, req.user);
  await writeAudit(req, 'money.bill.pay', 'Bill', bill.id, { paidOn: bill.paidOn, paidMethod: bill.paidMethod });
  res.json({ bill: bills.billJson(bill) });
});

const voidIt = asyncHandler(async (req, res) => {
  const bill = await bills.voidBill(await findBill(req), req.body || {}, req.user, await orgToday());
  await writeAudit(req, 'money.bill.void', 'Bill', bill.id, { reason: bill.voidReason });
  res.json({ bill: bills.billJson(bill) });
});

// POST /money/bills/:id/file — the vendor's PDF (after the usual checks).
const uploadFile = asyncHandler(async (req, res) => {
  const bill = await findBill(req);
  if (!req.file) throw new ApiError(400, 'Choose a file', 'VALIDATION_ERROR');
  if (!FILE_TYPES.has(path.extname(req.file.originalname).toLowerCase())) {
    fs.promises.unlink(req.file.path).catch(() => {});
    throw new ApiError(400, 'The bill must be a PDF, PNG or JPG', 'INVALID_FILE_TYPE');
  }
  const old = bill.filePath;
  await bill.update({ filePath: req.file.filename, fileName: req.file.originalname.slice(0, 255) });
  if (old && old !== req.file.filename) fs.promises.unlink(path.join(UPLOAD_ROOT, 'bills', String(bill.id), path.basename(old))).catch(() => {});
  res.status(201).json({ bill: bills.billJson(await bills.load(bill.id)) });
});

const downloadFile = asyncHandler(async (req, res) => {
  const bill = await findBill(req);
  if (!bill.filePath) throw new ApiError(404, 'No file on this bill', 'NOT_FOUND');
  const file = path.join(UPLOAD_ROOT, 'bills', String(bill.id), path.basename(bill.filePath));
  if (!fs.existsSync(file)) throw new ApiError(404, 'The file is missing', 'FILE_MISSING');
  res.download(file, bill.fileName || 'bill');
});

// GET /tickets/:id/bills and /projects/:id/bills — the job's bills.
function forJob(kind) {
  return asyncHandler(async (req, res) => {
    const job = kind === 'ticket'
      ? await findAccessibleTicket(req.user, parseRecordId(req.params.id) || 0)
      : await findAccessibleProject(req.user, parseRecordId(req.params.id) || 0);
    if (!job) throw new ApiError(404, `${kind === 'ticket' ? 'Ticket' : 'Project'} not found`, 'NOT_FOUND');
    const lineWhere = kind === 'ticket' ? { ticketId: job.id } : { projectId: job.id };
    const rows = await Bill.findAll({
      where: { status: { [Op.ne]: 'void' } },
      include: [
        { model: BillLine, as: 'lines', where: lineWhere, required: true },
        { model: Company, as: 'vendor', attributes: ['id', 'name'] },
      ],
      order: [['billDate', 'DESC']],
    });
    const amounts = await canSeeAmounts(req.user);
    res.json({ bills: rows.map((b) => bills.billJson(b, { canSeeAmounts: amounts })) });
  });
}

module.exports = {
  list, get, create, update, enter, pay, voidIt, uploadFile, downloadFile, ticketBills: forJob('ticket'), projectBills: forJob('project'),
};
