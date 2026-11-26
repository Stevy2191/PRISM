// Payments (Phase 3, step 3), for staff: payments received by hand, credit
// applied or refunded, refunds, and the list. Reading needs
// money.billing.view (or .manage), changing money.billing.manage; every
// record is reached through a company in the caller's reach.
const { Op } = require('sequelize');
const { Payment, Invoice, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId, canAccessCompany, companyScopeWhere } = require('../../services/permissionService');
const invoices = require('../../services/money/invoices');
const payments = require('../../services/money/payments');

async function findInvoice(req) {
  const invoice = await invoices.load(parseRecordId(req.params.id) || 0);
  if (!invoice || !(await canAccessCompany(req.user, invoice.companyId))) throw new ApiError(404, 'Invoice not found', 'NOT_FOUND');
  return invoice;
}
async function findPayment(req) {
  const payment = await Payment.findByPk(parseRecordId(req.params.id) || 0);
  if (!payment || !(await canAccessCompany(req.user, payment.companyId))) throw new ApiError(404, 'Payment not found', 'NOT_FOUND');
  return payment;
}

// GET /money/payments?companyId=&invoiceId=&from=&to=
const list = asyncHandler(async (req, res) => {
  const where = { ...(await companyScopeWhere(req.user, 'companyId')) };
  if (req.query.companyId) {
    const id = parseRecordId(req.query.companyId) || -1;
    if (!(await canAccessCompany(req.user, id))) return res.json({ payments: [] });
    where.companyId = id;
  }
  if (req.query.invoiceId) where.invoiceId = parseRecordId(req.query.invoiceId) || -1;
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (isDate(req.query.from) || isDate(req.query.to)) {
    where.receivedOn = { ...(isDate(req.query.from) ? { [Op.gte]: req.query.from } : {}), ...(isDate(req.query.to) ? { [Op.lte]: req.query.to } : {}) };
  }
  const rows = await Payment.findAll({
    where,
    include: [{ model: Invoice, as: 'invoice', attributes: ['id', 'number'] }, { model: Company, as: 'company', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  return res.json({ payments: rows.map(payments.paymentJson) });
});

// POST /money/invoices/:id/payments { method, amount, receivedOn, reference? }
const record = asyncHandler(async (req, res) => {
  const invoice = await findInvoice(req);
  const payment = await payments.recordPayment(invoice, req.body || {}, { userId: req.user.id });
  await writeAudit(req, 'money.payment.record', 'Payment', payment.id, { invoiceId: invoice.id, method: payment.method, amount: payment.amount });
  res.status(201).json({ payment: payments.paymentJson(payment), invoice: invoices.invoiceJson(await invoices.load(invoice.id)) });
});

// POST /money/invoices/:id/apply-credit { amount }
const applyCredit = asyncHandler(async (req, res) => {
  const invoice = await findInvoice(req);
  await payments.applyCredit(invoice, req.body || {}, { userId: req.user.id });
  await writeAudit(req, 'money.credit.apply', 'Invoice', invoice.id, { amount: (req.body || {}).amount });
  res.json({ invoice: invoices.invoiceJson(await invoices.load(invoice.id)) });
});

// POST /money/payments/:id/refund { amount, reason, method? (by hand) }
const refund = asyncHandler(async (req, res) => {
  const payment = await findPayment(req);
  const row = await payments.refundPayment(payment, req.body || {}, { userId: req.user.id });
  await writeAudit(req, 'money.payment.refund', 'Payment', payment.id, { amount: row.amount, method: row.method });
  const invoice = payment.invoiceId ? invoices.invoiceJson(await invoices.load(payment.invoiceId)) : null;
  res.status(201).json({ refund: { id: row.id, amount: row.amount, method: row.method }, invoice });
});

// GET /companies/:id/credit (the company's reach is checked by the route)
const credit = asyncHandler(async (req, res) => {
  res.json({ credit: await payments.creditBalance(req.billingCompany.id) });
});

// POST /companies/:id/credit/refund { amount, method, reference?, reason? }
const refundCredit = asyncHandler(async (req, res) => {
  const row = await payments.refundCredit(req.billingCompany, req.body || {}, { userId: req.user.id });
  await writeAudit(req, 'money.credit.refund', 'Company', req.billingCompany.id, { amount: row.amount, method: row.method });
  res.status(201).json({ refund: { id: row.id, amount: row.amount, method: row.method }, credit: await payments.creditBalance(req.billingCompany.id) });
});

module.exports = {
  list, record, applyCredit, refund, credit, refundCredit,
};
