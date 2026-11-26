// Invoices in the client portal (Phase 3, step 3). Company portal admins see
// all of their company's sent invoices; other contacts the ones billed to
// them. Drafts never show; anything else reads as not found. Paying opens
// the same Stripe Checkout as the emailed pay link.
const { Invoice, InvoiceLine } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { parseRecordId } = require('../../services/permissionService');
const { isCompanyAdmin } = require('../../services/portal/scope');
const { portalUrl } = require('../../services/portal/portalMail');
const { D, cents, unit } = require('../../services/money/money');
const { balanceOf } = require('../../services/money/invoices');
const { invoicePdfFor, pdfName } = require('../../services/money/invoicePdf');
const payments = require('../../services/money/payments');

const SHOWN = ['sent', 'partly_paid', 'paid'];

async function whereFor(contact) {
  const where = { companyId: contact.companyId, kind: 'invoice', status: SHOWN };
  if (!(await isCompanyAdmin(contact))) where.billToContactId = contact.id;
  return where;
}

function view(inv) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    issuedOn: inv.issuedOn,
    dueOn: inv.dueOn,
    subtotal: cents(inv.subtotal),
    taxTotal: cents(inv.taxTotal),
    total: cents(inv.total),
    paid: cents(D(inv.amountPaid).plus(inv.creditApplied)),
    balance: balanceOf(inv),
    lines: inv.lines ? [...inv.lines].sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id).map((l) => ({
      description: l.description, quantity: unit(l.quantity), unitPrice: unit(l.unitPrice), amount: cents(l.amount),
    })) : undefined,
  };
}

async function findInvoice(req) {
  const inv = await Invoice.findOne({
    where: { ...(await whereFor(req.contact)), id: parseRecordId(req.params.id) || 0 },
    include: [{ model: InvoiceLine, as: 'lines' }],
  });
  if (!inv) throw new ApiError(404, 'Invoice not found', 'NOT_FOUND');
  return inv;
}

const list = asyncHandler(async (req, res) => {
  const rows = await Invoice.findAll({ where: await whereFor(req.contact), order: [['issuedOn', 'DESC'], ['id', 'DESC']], limit: 200 });
  res.json({ invoices: rows.map(view) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ invoice: view(await findInvoice(req)) });
});

const pdf = asyncHandler(async (req, res) => {
  const inv = await findInvoice(req);
  const buffer = await invoicePdfFor(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfName(inv)}"`);
  res.send(buffer);
});

// POST .../invoices/:id/pay → { url } (the amount is the server's).
const pay = asyncHandler(async (req, res) => {
  const inv = await findInvoice(req);
  if (!['sent', 'partly_paid'].includes(inv.status)) throw new ApiError(409, 'This invoice is paid', 'INVOICE_STATE');
  const back = portalUrl(req.portalCompany, '/invoices');
  res.json(await payments.createCheckout(inv, { successUrl: `${back}?paid=1`, cancelUrl: back }));
});

module.exports = {
  list, get, pdf, pay,
};
