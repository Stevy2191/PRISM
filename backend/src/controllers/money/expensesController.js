// Expenses (Phase 3, step 2): /money/expenses (money.bills.manage).
const fs = require('fs');
const path = require('path');
const { Expense, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { parseRecordId } = require('../../services/permissionService');
const { orgToday } = require('../../utils/orgTime');
const expenses = require('../../services/money/expenses');

const FILE_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

async function findExpense(req) {
  const e = await Expense.findByPk(parseRecordId(req.params.id) || 0);
  if (!e) throw new ApiError(404, 'Expense not found', 'NOT_FOUND');
  return e;
}

// GET /money/expenses?account=&ticketId=&projectId=&vendorCompanyId=&billingStatus=&from=&to=&voided=true
const list = asyncHandler(async (req, res) => {
  const rows = await Expense.findAll({
    where: expenses.listWhere(req.query),
    include: [{ model: Company, as: 'vendor', attributes: ['id', 'name'] }],
    order: [['spentOn', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  res.json({ expenses: rows.map(expenses.expenseJson) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ expense: expenses.expenseJson(await findExpense(req)) });
});

const create = asyncHandler(async (req, res) => {
  const e = await expenses.recordExpense(req.body || {}, req.user);
  await writeAudit(req, 'money.expense.create', 'Expense', e.id, { account: e.account, amount: e.amount, ticketId: e.ticketId, projectId: e.projectId });
  res.status(201).json({ expense: expenses.expenseJson(e) });
});

const update = asyncHandler(async (req, res) => {
  const e = await expenses.updateExpense(await findExpense(req), req.body || {});
  await writeAudit(req, 'money.expense.update', 'Expense', e.id, { fields: Object.keys(req.body || {}) });
  res.json({ expense: expenses.expenseJson(e) });
});

const voidIt = asyncHandler(async (req, res) => {
  const e = await expenses.voidExpense(await findExpense(req), req.body || {}, req.user, await orgToday());
  await writeAudit(req, 'money.expense.void', 'Expense', e.id, { reason: e.voidReason });
  res.json({ expense: expenses.expenseJson(e) });
});

const uploadReceipt = asyncHandler(async (req, res) => {
  const e = await findExpense(req);
  if (!req.file) throw new ApiError(400, 'Choose a file', 'VALIDATION_ERROR');
  if (!FILE_TYPES.has(path.extname(req.file.originalname).toLowerCase())) {
    fs.promises.unlink(req.file.path).catch(() => {});
    throw new ApiError(400, 'The receipt must be a PDF, PNG or JPG', 'INVALID_FILE_TYPE');
  }
  const old = e.receiptFile;
  await e.update({ receiptFile: req.file.filename, receiptName: req.file.originalname.slice(0, 255) });
  if (old && old !== req.file.filename) fs.promises.unlink(path.join(UPLOAD_ROOT, 'expenses', String(e.id), path.basename(old))).catch(() => {});
  await writeAudit(req, 'money.expense.receipt', 'Expense', e.id, { receiptName: e.receiptName });
  res.status(201).json({ expense: expenses.expenseJson(e) });
});

const downloadReceipt = asyncHandler(async (req, res) => {
  const e = await findExpense(req);
  if (!e.receiptFile) throw new ApiError(404, 'No receipt on this expense', 'NOT_FOUND');
  const file = path.join(UPLOAD_ROOT, 'expenses', String(e.id), path.basename(e.receiptFile));
  if (!fs.existsSync(file)) throw new ApiError(404, 'The receipt is missing', 'FILE_MISSING');
  res.download(file, e.receiptName || 'receipt');
});

module.exports = {
  list, get, create, update, voidIt, uploadReceipt, downloadReceipt,
};
