// The pay link (Phase 3, step 3): public, no sign-in. The token in the
// emailed link is the only key, and it opens one invoice: its number,
// dates, lines and totals, and the business's name — nothing else. Paying
// goes to Stripe Checkout for the balance the server works out. And
// Stripe's webhook, which records payments only when Stripe signed it.
const { asyncHandler } = require('../../middleware/error');
const { getAllSettings } = require('../settingsController');
const { surveyBaseUrl } = require('../../services/csatService');
const { D, cents, unit } = require('../../services/money/money');
const payments = require('../../services/money/payments');
const stripe = require('../../services/money/stripe');
const { balanceOf } = require('../../services/money/invoices');
const { invoicePdfFor, pdfName } = require('../../services/money/invoicePdf');

async function publicJson(inv) {
  const settings = await getAllSettings();
  const lines = [...inv.lines].sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id);
  return {
    invoice: {
      number: inv.number,
      status: inv.status,
      issuedOn: inv.issuedOn,
      dueOn: inv.dueOn,
      lines: lines.map((l) => ({
        description: l.description, quantity: unit(l.quantity), unitPrice: unit(l.unitPrice), amount: cents(l.amount),
      })),
      subtotal: cents(inv.subtotal),
      taxTotal: cents(inv.taxTotal),
      total: cents(inv.total),
      paid: cents(D(inv.amountPaid).plus(inv.creditApplied)),
      balance: balanceOf(inv),
    },
    business: { name: settings['company.name'] || settings['branding.appName'] || 'PRISM' },
    canPayOnline: (await stripe.status()).stripeConfigured,
  };
}

const show = asyncHandler(async (req, res) => {
  res.json(await publicJson(await payments.invoiceByPayToken(req.params.token)));
});

const pdf = asyncHandler(async (req, res) => {
  const inv = await payments.invoiceByPayToken(req.params.token);
  const buffer = await invoicePdfFor(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${pdfName(inv)}"`);
  res.send(buffer);
});

// POST /pay/:token/checkout → { url }. The amount is never read from the
// request. Stripe's return pages don't carry the token (it stays private).
const checkout = asyncHandler(async (req, res) => {
  const inv = await payments.invoiceByPayToken(req.params.token);
  const base = surveyBaseUrl();
  res.json(await payments.createCheckout(inv, { successUrl: `${base}/pay/thanks`, cancelUrl: `${base}/pay/cancelled` }));
});

// POST /money/stripe/webhook: Stripe's signed events, raw body kept by app.js.
const webhook = asyncHandler(async (req, res) => {
  const event = await stripe.verifiedEvent(req.rawBody, req.get('stripe-signature'));
  await payments.handleStripeEvent(event);
  res.json({ received: true });
});

module.exports = {
  show, pdf, checkout, webhook,
};
