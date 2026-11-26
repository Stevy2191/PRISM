// Emailing an invoice (Phase 3, step 3): a fresh pay link (the last one
// stops working), the invoice_sent template, the PDF attached. Sent to the
// invoice's bill-to contact, or else the company's portal admins.
const { Contact, CompanyPortalAdmin } = require('../../models');
const { sendMail } = require('../emailSender');
const { render } = require('../email/templates');
const { surveyBaseUrl } = require('../csatService');
const { D, cents } = require('./money');
const { newPayToken, savePayToken } = require('./payments');
const { invoicePdfFor, pdfName } = require('./invoicePdf');

const usd = (v) => `$${D(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const payUrl = (token) => `${surveyBaseUrl()}/pay/${token}`;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function recipients(invoice) {
  if (invoice.billToContactId) {
    const c = await Contact.findByPk(invoice.billToContactId);
    if (c && c.status === 'active' && EMAIL.test(c.email || '')) return [c];
  }
  const admins = await CompanyPortalAdmin.findAll({ where: { companyId: invoice.companyId }, include: [{ model: Contact, as: 'contact' }] });
  return admins.map((x) => x.contact).filter((c) => c && c.status === 'active' && EMAIL.test(c.email || ''));
}

// → { emailed, to: [emails], payUrl, reason? }. Never throws for a mail
// failure. template: invoice_sent, or a reminder (no PDF attached).
// The new link is put in force only once its email has gone: a reminder
// that isn't sent never breaks the link the customer already has.
async function emailInvoice(invoice, { template = 'invoice_sent' } = {}) {
  const token = newPayToken();
  const url = payUrl(token);
  const to = await recipients(invoice);
  if (!to.length) return { emailed: false, to: [], payUrl: null, reason: 'No one to send it to: choose who it\'s billed to' };
  try {
    const first = to[0];
    const out = await render(template, {
      contact: { firstName: first.firstName || first.displayName || '', name: first.displayName || '' },
      invoice: {
        number: invoice.number,
        total: usd(invoice.total),
        balance: usd(cents(D(invoice.total).minus(invoice.amountPaid).minus(invoice.creditApplied))),
        dueOn: invoice.dueOn || '',
        payUrl: url,
      },
    });
    if (!out.enabled) return { emailed: false, to: [], payUrl: null, reason: 'That email is switched off' };
    const pdf = template === 'invoice_sent' ? await invoicePdfFor(invoice) : null;
    await sendMail({
      to: to.map((c) => c.email),
      subject: out.subject,
      html: out.html,
      text: out.text,
      attachments: [...out.attachments, ...(pdf ? [{ filename: pdfName(invoice), content: pdf, contentType: 'application/pdf' }] : [])],
    });
    await savePayToken(invoice, token);
    return { emailed: true, to: to.map((c) => c.email), payUrl: url };
  } catch (err) {
    return { emailed: false, to: [], payUrl: null, reason: err.message };
  }
}

module.exports = { emailInvoice, payUrl };
