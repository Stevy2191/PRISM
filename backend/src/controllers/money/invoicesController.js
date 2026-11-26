// Invoices (Phase 3, step 3): /money/invoices and a company's invoices.
// Reading needs money.billing.view (or .manage), everything else
// money.billing.manage; an invoice is reached only through a company in the
// caller's reach (out of reach reads as not found).
const { Op } = require('sequelize');
const { Invoice, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId, canAccessCompany, companyScopeWhere } = require('../../services/permissionService');
const { escapeLike } = require('../../utils/escapeLike');
const invoices = require('../../services/money/invoices');
const { invoicePdfFor, pdfName } = require('../../services/money/invoicePdf');
const { emailInvoice } = require('../../services/money/invoiceMail');

const notFound = () => new ApiError(404, 'Invoice not found', 'NOT_FOUND');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function findInvoice(req) {
  const invoice = await invoices.load(parseRecordId(req.params.id) || 0);
  if (!invoice || !(await canAccessCompany(req.user, invoice.companyId))) throw notFound();
  return invoice;
}

async function listWhere(req, extra = {}) {
  const q = req.query;
  const where = { ...(await companyScopeWhere(req.user, 'companyId')), ...extra };
  if (['draft', 'sent', 'partly_paid', 'paid', 'void'].includes(q.status)) where.status = q.status;
  if (q.status === 'open') where.status = ['sent', 'partly_paid'];
  if (['invoice', 'credit_note'].includes(q.kind)) where.kind = q.kind;
  if (isDate(q.from) || isDate(q.to)) where.issuedOn = { ...(isDate(q.from) ? { [Op.gte]: q.from } : {}), ...(isDate(q.to) ? { [Op.lte]: q.to } : {}) };
  const search = String(q.search || '').trim().slice(0, 60);
  if (search) where.number = { [Op.like]: `%${escapeLike(search)}%` };
  return where;
}

async function sendList(res, where) {
  const rows = await Invoice.findAll({
    where,
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
    order: [['issuedOn', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  res.json({ invoices: rows.map(invoices.invoiceJson) });
}

// GET /money/invoices?companyId=&status=&kind=&from=&to=&search=
const list = asyncHandler(async (req, res) => {
  const where = await listWhere(req);
  if (req.query.companyId) {
    const id = parseRecordId(req.query.companyId) || -1;
    if (!(await canAccessCompany(req.user, id))) return res.json({ invoices: [] });
    where.companyId = id;
  }
  return sendList(res, where);
});

// GET /companies/:id/invoices (the company's reach is checked by the route)
const forCompany = asyncHandler(async (req, res) => {
  sendList(res, await listWhere(req, { companyId: req.billingCompany.id }));
});

const get = asyncHandler(async (req, res) => {
  res.json({ invoice: invoices.invoiceJson(await findInvoice(req)) });
});

const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const company = await Company.findByPk(parseRecordId(body.companyId) || 0);
  if (!company || !(await canAccessCompany(req.user, company.id))) throw new ApiError(404, 'Company not found', 'NOT_FOUND');
  const invoice = await invoices.createDraft(company, { lines: body.lines, notes: body.notes, chargeTax: body.chargeTax, billToContactId: body.billToContactId }, { userId: req.user.id });
  await writeAudit(req, 'money.invoice.create', 'Invoice', invoice.id, { companyId: company.id, total: invoice.total });
  res.status(201).json({ invoice: invoices.invoiceJson(invoice) });
});

const update = asyncHandler(async (req, res) => {
  const invoice = await invoices.updateDraft(await findInvoice(req), req.body || {});
  await writeAudit(req, 'money.invoice.update', 'Invoice', invoice.id, { fields: Object.keys(req.body || {}) });
  res.json({ invoice: invoices.invoiceJson(invoice) });
});

const remove = asyncHandler(async (req, res) => {
  const invoice = await findInvoice(req);
  await invoices.deleteDraft(invoice);
  await writeAudit(req, 'money.invoice.delete', 'Invoice', invoice.id, { companyId: invoice.companyId });
  res.json({ ok: true });
});

const send = asyncHandler(async (req, res) => {
  const invoice = await invoices.sendInvoice(await findInvoice(req), { userId: req.user.id, issuedOn: (req.body || {}).issuedOn || null });
  // Emailed with its pay link once it's sent; a mail failure doesn't unsend it.
  const delivery = invoice.status === 'paid' ? null : await emailInvoice(invoice);
  await writeAudit(req, 'money.invoice.send', 'Invoice', invoice.id, { number: invoice.number, total: invoice.total, emailed: delivery ? delivery.emailed : false });
  res.json({ invoice: invoices.invoiceJson(invoice), delivery });
});

const voidIt = asyncHandler(async (req, res) => {
  const invoice = await invoices.voidInvoice(await findInvoice(req), { reason: (req.body || {}).reason, userId: req.user.id });
  await writeAudit(req, 'money.invoice.void', 'Invoice', invoice.id, { number: invoice.number, reason: invoice.voidReason });
  res.json({ invoice: invoices.invoiceJson(invoice) });
});

const creditNote = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const note = await invoices.issueCreditNote(await findInvoice(req), { lines: body.lines, reason: body.reason }, { userId: req.user.id });
  await writeAudit(req, 'money.invoice.credit', 'Invoice', note.id, { number: note.number, creditFor: note.creditForInvoiceId, total: note.total });
  res.status(201).json({ invoice: invoices.invoiceJson(note) });
});

const pdf = asyncHandler(async (req, res) => {
  const invoice = await findInvoice(req);
  const buffer = await invoicePdfFor(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfName(invoice)}"`);
  res.send(buffer);
});

// POST /money/invoices/:id/email: a fresh pay link, emailed again.
const email = asyncHandler(async (req, res) => {
  const invoice = await findInvoice(req);
  if (invoice.kind !== 'invoice' || !['sent', 'partly_paid'].includes(invoice.status)) {
    throw new ApiError(409, 'Only an open invoice is emailed', 'INVOICE_STATE');
  }
  const delivery = await emailInvoice(invoice);
  await writeAudit(req, 'money.invoice.email', 'Invoice', invoice.id, { emailed: delivery.emailed, to: delivery.to });
  res.json({ delivery });
});

module.exports = {
  list, forCompany, get, create, update, remove, send, voidIt, creditNote, pdf, email,
};
