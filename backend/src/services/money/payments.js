// Payments (Phase 3, step 3). Money in, for an invoice:
//   by hand (check, cash, transfer)      Dr 1000 Cash
//   through Stripe (card, bank account)  Dr 1010 Stripe clearing, and its fee Dr 6000 / Cr 1010
// credited Cr 1100 up to what's owed; anything over becomes the customer's
// credit (Cr 2200); an online-payment fee, when set, is income (Cr 4300).
// Credit is applied to an invoice (Dr 2200 / Cr 1100) or refunded. A refund
// of a payment takes back, in order, what went to credit, then what paid the
// invoice (which is owed again), then the fee. Every amount is worked out
// here; nothing a browser sends is trusted. Rows are locked while changed.
const crypto = require('crypto');
const { Op, UniqueConstraintError } = require('sequelize');
const {
  Invoice, Payment, Refund, Company, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { orgToday } = require('../../utils/orgTime');
const { D, cents } = require('./money');
const { moneyConfig } = require('./config');
const ledger = require('./ledger');
const invoices = require('./invoices');
const stripe = require('./stripe');

const HAND_METHODS = ['check', 'cash', 'transfer'];
const STRIPE_METHODS = ['card', 'us_bank_account'];
const PAY_LINK_DAYS = 180;
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const min = (...xs) => xs.reduce((m, x) => (D(x).lt(m) ? D(x) : m), D(xs[0]));
const pos = (x) => D(x).gt(0);

function amountOf(raw, label = 'The amount') {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || D(s).isZero()) throw bad(`${label} must be over 0, like 145 or 99.50`);
  return cents(s);
}
function text(raw, label, max) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s.length > max) throw bad(`${label} is too long`);
  return s || null;
}

const owed = (inv) => D(invoices.balanceOf(inv));
function settledStatus(inv) {
  if (owed(inv).lte(0)) return 'paid';
  return D(inv.amountPaid).plus(inv.creditApplied).gt(0) ? 'partly_paid' : 'sent';
}

async function lockInvoice(id, transaction) {
  return Invoice.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
}
async function lockOpenInvoice(id, transaction) {
  const inv = await lockInvoice(id, transaction);
  if (!inv || inv.kind !== 'invoice' || !['sent', 'partly_paid'].includes(inv.status)) {
    throw new ApiError(409, 'This invoice isn\'t open for payment', 'INVOICE_STATE');
  }
  return inv;
}

// The customer's unused credit (ledger account 2200 for the company).
async function creditBalance(companyId, { transaction = null } = {}) {
  const rows = await ledger.balances({ companyId, transaction });
  const row = rows.find((r) => r.code === '2200');
  return cents(row ? row.balance : 0);
}
async function lockCompany(companyId, transaction) {
  return Company.findByPk(companyId, { transaction, lock: transaction.LOCK.UPDATE });
}

function receiptLines(cashAccount, { amount, applied, credit, surcharge }) {
  const lines = [{ account: cashAccount, debit: cents(amount) }];
  if (pos(applied)) lines.push({ account: '1100', credit: cents(applied) });
  if (pos(credit)) lines.push({ account: '2200', credit: cents(credit) });
  if (pos(surcharge)) lines.push({ account: '4300', credit: cents(surcharge) });
  return lines;
}

// Applies `amount` to a locked invoice; → { applied, credit }.
async function applyToInvoice(inv, amount, transaction) {
  const open = inv.kind === 'invoice' && ['sent', 'partly_paid'].includes(inv.status);
  const due = owed(inv);
  const applied = open && due.gt(0) ? min(amount, due) : D(0);
  const credit = D(amount).minus(applied);
  if (pos(applied)) {
    inv.amountPaid = cents(D(inv.amountPaid).plus(applied));
    await inv.update({ amountPaid: inv.amountPaid, status: settledStatus(inv) }, { transaction });
  }
  return { applied: cents(applied), credit: cents(credit) };
}

// A check, cash or a transfer received for an invoice.
async function recordPayment(invoice, body, { userId = null } = {}) {
  if (!HAND_METHODS.includes(body.method)) throw bad('Choose check, cash or transfer (card and bank payments come through Stripe)');
  const amount = amountOf(body.amount);
  if (!isDate(body.receivedOn)) throw bad('Choose the day it was received');
  const reference = text(body.reference, 'The reference', 100);
  const paymentId = await sequelize.transaction(async (t) => {
    const inv = await lockOpenInvoice(invoice.id, t);
    const { applied, credit } = await applyToInvoice(inv, amount, t);
    const entry = await ledger.postEntry({
      date: body.receivedOn, memo: `Payment for ${inv.number}${reference ? ` (${body.method} ${reference})` : ''}`, sourceType: 'payment', sourceId: inv.id, companyId: inv.companyId,
      lines: receiptLines('1000', {
        amount, applied, credit, surcharge: 0,
      }),
    }, { transaction: t, userId });
    const payment = await Payment.create({
      companyId: inv.companyId, invoiceId: inv.id, method: body.method, status: 'succeeded', amount, appliedAmount: applied, creditAmount: credit, receivedOn: body.receivedOn, reference, ledgerEntryId: entry.id, createdBy: userId,
    }, { transaction: t });
    return payment.id;
  });
  return Payment.findByPk(paymentId);
}

// Part of the customer's credit, put against an open invoice.
async function applyCredit(invoice, body, { userId = null } = {}) {
  const amount = amountOf(body.amount);
  await sequelize.transaction(async (t) => {
    await lockCompany(invoice.companyId, t);
    const inv = await lockOpenInvoice(invoice.id, t);
    const available = await creditBalance(inv.companyId, { transaction: t });
    if (D(amount).gt(available)) throw bad(`That's more than the customer's credit (${available})`);
    if (D(amount).gt(owed(inv))) throw bad(`That's more than is owed (${invoices.balanceOf(inv)})`);
    const date = await orgToday();
    const entry = await ledger.postEntry({
      date, memo: `Credit applied to ${inv.number}`, sourceType: 'credit_apply', sourceId: inv.id, companyId: inv.companyId,
      lines: [{ account: '2200', debit: amount }, { account: '1100', credit: amount }],
    }, { transaction: t, userId });
    inv.creditApplied = cents(D(inv.creditApplied).plus(amount));
    await inv.update({ creditApplied: inv.creditApplied, status: settledStatus(inv) }, { transaction: t });
    await Payment.create({
      companyId: inv.companyId, invoiceId: inv.id, method: 'credit', status: 'succeeded', amount, appliedAmount: amount, receivedOn: date, ledgerEntryId: entry.id, createdBy: userId,
    }, { transaction: t });
  });
}

// Credit given back to the customer by hand.
async function refundCredit(company, body, { userId = null } = {}) {
  if (!HAND_METHODS.includes(body.method)) throw bad('Choose check, cash or transfer');
  const amount = amountOf(body.amount);
  const reason = text(body.reason, 'The reason', 255);
  const reference = text(body.reference, 'The reference', 100);
  return sequelize.transaction(async (t) => {
    await lockCompany(company.id, t);
    const available = await creditBalance(company.id, { transaction: t });
    if (D(amount).gt(available)) throw bad(`That's more than the customer's credit (${available})`);
    const entry = await ledger.postEntry({
      date: await orgToday(), memo: `Credit refunded${reference ? ` (${body.method} ${reference})` : ''}`, sourceType: 'refund', companyId: company.id,
      lines: [{ account: '2200', debit: amount }, { account: '1000', credit: amount }],
    }, { transaction: t, userId });
    return Refund.create({
      companyId: company.id, amount, method: body.method, fromCredit: true, reason, reference, ledgerEntryId: entry.id, createdBy: userId,
    }, { transaction: t });
  });
}

// How `total` refunded so far splits over a payment's parts, in refund order.
function split(payment, total) {
  const credit = min(total, payment.creditAmount);
  const applied = min(D(total).minus(credit), payment.appliedAmount);
  return { credit, applied, surcharge: D(total).minus(credit).minus(applied) };
}

// What a refund of `amount` takes back from each part of the payment, and
// whether PRISM would accept it now (strict): not more than is left of the
// payment, and the credit part still unused. → { part, refundable }
async function refundParts(payment, amount, { transaction, strict }) {
  const refundable = D(payment.amount).minus(payment.refundedAmount);
  if (D(amount).gt(refundable)) throw bad(`That's more than is left of the payment (${cents(refundable)})`);
  const before = split(payment, payment.refundedAmount);
  const after = split(payment, D(payment.amount).minus(refundable).plus(amount));
  const part = {
    credit: after.credit.minus(before.credit), applied: after.applied.minus(before.applied), surcharge: after.surcharge.minus(before.surcharge),
  };
  if (strict && pos(part.credit) && part.credit.gt(await creditBalance(payment.companyId, { transaction }))) {
    throw bad('The customer\'s credit from this payment has been used; refund less');
  }
  return part;
}

// Records a refund of a payment (already made in Stripe, or by hand).
// Idempotent on stripeRefundId. A refund Stripe has made is always
// recorded (strict: false): if the customer's credit from it was used, their
// credit goes below zero — they owe it — rather than the books disagreeing
// with Stripe. → the Refund.
async function recordRefund(paymentId, {
  amount, method, stripeRefundId = null, reason = null, reference = null, userId = null, strict = true,
}) {
  try {
    return await sequelize.transaction(async (t) => {
      if (stripeRefundId) {
        const seen = await Refund.findOne({ where: { stripeRefundId }, transaction: t });
        if (seen) return seen;
      }
      const payment = await Payment.findByPk(paymentId, { transaction: t, lock: t.LOCK.UPDATE });
      await lockCompany(payment.companyId, t);
      const part = await refundParts(payment, amount, { transaction: t, strict });
      if (!strict && pos(part.credit) && part.credit.gt(await creditBalance(payment.companyId, { transaction: t }))) {
        console.warn(`[payments] refund ${stripeRefundId} takes back credit already used; customer ${payment.companyId}'s credit goes below zero`);
      }
      const lines = [];
      if (pos(part.credit)) lines.push({ account: '2200', debit: cents(part.credit) });
      if (pos(part.applied)) lines.push({ account: '1100', debit: cents(part.applied) });
      if (pos(part.surcharge)) lines.push({ account: '4300', debit: cents(part.surcharge) });
      lines.push({ account: method === 'stripe' ? '1010' : '1000', credit: cents(amount) });
      const entry = await ledger.postEntry({
        date: await orgToday(), memo: `Refund${reason ? `: ${reason}` : ''}`, sourceType: 'refund', sourceId: payment.id, companyId: payment.companyId, lines,
      }, { transaction: t, userId });
      if (pos(part.applied) && payment.invoiceId) {
        const inv = await lockInvoice(payment.invoiceId, t);
        inv.amountPaid = cents(D(inv.amountPaid).minus(part.applied));
        const status = inv.status === 'void' ? 'void' : settledStatus(inv);
        await inv.update({ amountPaid: inv.amountPaid, status }, { transaction: t });
      }
      await payment.update({ refundedAmount: cents(D(payment.refundedAmount).plus(amount)) }, { transaction: t });
      return Refund.create({
        companyId: payment.companyId, paymentId: payment.id, amount: cents(amount), method, reason, reference, stripeRefundId, ledgerEntryId: entry.id, createdBy: userId,
      }, { transaction: t });
    });
  } catch (err) {
    // The same Stripe refund recorded at the same moment by the webhook.
    if (err instanceof UniqueConstraintError && stripeRefundId) return Refund.findOne({ where: { stripeRefundId } });
    throw err;
  }
}

// A refund asked for in PRISM: through Stripe for online payments.
async function refundPayment(payment, body, { userId = null } = {}) {
  if (payment.status !== 'succeeded') throw new ApiError(409, 'Only a received payment can be refunded', 'PAYMENT_STATE');
  if (payment.method === 'credit') throw bad('Credit applied to an invoice isn\'t refunded; issue a credit note instead');
  const amount = amountOf(body.amount);
  const reason = text(body.reason, 'The reason', 255);
  if (D(amount).gt(D(payment.amount).minus(payment.refundedAmount))) {
    throw bad(`That's more than is left of the payment (${cents(D(payment.amount).minus(payment.refundedAmount))})`);
  }
  if (STRIPE_METHODS.includes(payment.method)) {
    // Checked before Stripe is asked: a refund PRISM would refuse is never made.
    await sequelize.transaction(async (t) => {
      const row = await Payment.findByPk(payment.id, { transaction: t, lock: t.LOCK.UPDATE });
      await lockCompany(row.companyId, t);
      await refundParts(row, amount, { transaction: t, strict: true });
    });
    const refund = await (await stripe.client()).refunds.create({
      payment_intent: payment.stripePaymentIntentId, amount: Math.round(D(amount).times(100).toNumber()), metadata: { paymentId: String(payment.id) },
    });
    return recordRefund(payment.id, {
      amount, method: 'stripe', stripeRefundId: refund.id, reason, userId, strict: false,
    });
  }
  const method = HAND_METHODS.includes(body.method) ? body.method : 'check';
  return recordRefund(payment.id, {
    amount, method, reason, reference: text(body.reference, 'The reference', 100), userId,
  });
}

// ---- The pay link -----------------------------------------------------

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// A new link's token, not yet in force (savePayToken puts it in force).
const newPayToken = () => crypto.randomBytes(32).toString('base64url');

// Puts a link in force for the invoice; any earlier one stops working.
async function savePayToken(invoice, token, { transaction = null } = {}) {
  await Invoice.update(
    { payTokenHash: hashToken(token), payTokenExpiresAt: new Date(Date.now() + PAY_LINK_DAYS * 24 * 3600 * 1000) },
    { where: { id: invoice.id }, transaction },
  );
  return token;
}
const issuePayToken = (invoice, opts) => savePayToken(invoice, newPayToken(), opts);

const invalidLink = () => new ApiError(404, 'This payment link isn\'t valid. Ask us for a new one.', 'PAY_LINK_INVALID');
// The invoice a link shows: sent, not yet paid, not void, not expired.
async function invoiceByPayToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw invalidLink();
  const inv = await Invoice.findOne({ where: { payTokenHash: hashToken(token), payTokenExpiresAt: { [Op.gt]: new Date() } } });
  if (!inv || inv.kind !== 'invoice' || !['sent', 'partly_paid'].includes(inv.status)) throw invalidLink();
  return invoices.load(inv.id);
}

// Stripe Checkout for what's owed now (plus the online-payment fee, if set).
async function createCheckout(invoice, { successUrl, cancelUrl }) {
  const cfg = await moneyConfig();
  const balance = owed(invoice);
  if (!balance.gt(0)) throw invalidLink();
  const surcharge = D(cfg.cardFeePercent).gt(0) ? D(cents(balance.times(cfg.cardFeePercent).div(100))) : D(0);
  const centsOf = (x) => Math.round(D(x).times(100).toNumber());
  const currency = String(cfg.currency || 'USD').toLowerCase();
  const lineItems = [{ quantity: 1, price_data: { currency, unit_amount: centsOf(balance), product_data: { name: `Invoice ${invoice.number}` } } }];
  if (surcharge.gt(0)) {
    lineItems.push({ quantity: 1, price_data: { currency, unit_amount: centsOf(surcharge), product_data: { name: 'Online payment fee' } } });
  }
  // source: the webhook takes only sessions PRISM started (the Stripe account
  // may sell other things too).
  const metadata = { source: 'prism', invoiceId: String(invoice.id), fee: cents(surcharge) };
  const session = await (await stripe.client()).checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account'],
    line_items: lineItems,
    client_reference_id: String(invoice.id),
    metadata,
    payment_intent_data: { metadata },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { url: session.url };
}

// ---- Stripe's webhook ---------------------------------------------------

async function stripeFee(paymentIntentId) {
  if (!paymentIntentId) return '0.00';
  try {
    const pi = await (await stripe.client()).paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const bt = pi && pi.latest_charge && pi.latest_charge.balance_transaction;
    return cents(D((bt && bt.fee) || 0).div(100));
  } catch (err) {
    console.error('[stripe] could not read the fee for', paymentIntentId, err.message);
    return '0.00';
  }
}

// The invoice a Checkout session pays: only for sessions PRISM started
// (metadata.source) in the business's currency; anything else is ignored.
async function sessionInvoiceId(s) {
  const meta = s.metadata || {};
  if (meta.source !== 'prism') return null;
  const currency = String((await moneyConfig()).currency || 'USD').toLowerCase();
  if (String(s.currency || '').toLowerCase() !== currency) return null;
  const id = Number.parseInt(meta.invoiceId, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
const piOf = (s) => (typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || null);

// A bank payment started: recorded as pending, nothing posted.
async function pendingSession(s) {
  const invoiceId = await sessionInvoiceId(s);
  const inv = invoiceId && await Invoice.findByPk(invoiceId);
  if (!inv) return;
  try {
    await Payment.findOrCreate({
      where: { stripeSessionId: s.id },
      defaults: {
        companyId: inv.companyId, invoiceId: inv.id, method: 'us_bank_account', status: 'pending', amount: cents(D(s.amount_total || 0).div(100)), stripePaymentIntentId: piOf(s),
      },
    });
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
  }
}

// The money arrived: post it, once.
async function succeededSession(s, method) {
  const invoiceId = await sessionInvoiceId(s);
  if (!invoiceId) return;
  const amount = cents(D(s.amount_total || 0).div(100));
  const surchargeRaw = s.metadata && /^\d{1,9}(\.\d{1,2})?$/.test(String(s.metadata.fee || '')) ? s.metadata.fee : '0';
  const surcharge = cents(min(surchargeRaw, amount));
  const fee = await stripeFee(piOf(s));
  try {
    await sequelize.transaction(async (t) => {
      const existing = await Payment.findOne({ where: { stripeSessionId: s.id }, transaction: t, lock: t.LOCK.UPDATE });
      if (existing && existing.status === 'succeeded') return;
      const inv = await lockInvoice(invoiceId, t);
      if (!inv) return;
      const date = await orgToday();
      const { applied, credit } = await applyToInvoice(inv, cents(D(amount).minus(surcharge)), t);
      const entry = await ledger.postEntry({
        date, memo: `Online payment for ${inv.number}`, sourceType: 'payment', sourceId: inv.id, companyId: inv.companyId,
        lines: receiptLines('1010', {
          amount, applied, credit, surcharge,
        }),
      }, { transaction: t });
      const feeEntry = pos(fee) ? await ledger.postEntry({
        date, memo: `Stripe fee, ${inv.number}`, sourceType: 'stripe_fee', sourceId: inv.id, companyId: inv.companyId,
        lines: [{ account: '6000', debit: fee }, { account: '1010', credit: fee }],
      }, { transaction: t }) : null;
      const fields = {
        companyId: inv.companyId, invoiceId: inv.id, method: existing ? existing.method : method, status: 'succeeded', amount, appliedAmount: applied, creditAmount: credit, surcharge, fee, receivedOn: date, stripeSessionId: s.id, stripePaymentIntentId: piOf(s), ledgerEntryId: entry.id, feeEntryId: feeEntry ? feeEntry.id : null,
      };
      if (existing) await existing.update(fields, { transaction: t });
      else await Payment.create(fields, { transaction: t });
    });
  } catch (err) {
    // Delivered twice at once: the other delivery recorded it.
    if (!(err instanceof UniqueConstraintError)) throw err;
  }
}

async function failedSession(s) {
  const [n] = await Payment.update({ status: 'failed' }, { where: { stripeSessionId: s.id, status: 'pending' } });
  if (n) return;
  const invoiceId = await sessionInvoiceId(s);
  const inv = invoiceId && await Invoice.findByPk(invoiceId);
  if (!inv || await Payment.count({ where: { stripeSessionId: s.id } })) return;
  await Payment.create({
    companyId: inv.companyId, invoiceId: inv.id, method: 'us_bank_account', status: 'failed', amount: cents(D(s.amount_total || 0).div(100)), stripeSessionId: s.id, stripePaymentIntentId: piOf(s),
  }).catch((err) => { if (!(err instanceof UniqueConstraintError)) throw err; });
}

// Refunds made in Stripe (or by PRISM, reported back): each recorded once.
async function refundedCharge(charge) {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  const payment = pi && await Payment.findOne({ where: { stripePaymentIntentId: pi, status: 'succeeded' } });
  if (!payment) return;
  const list = await (await stripe.client()).refunds.list({ payment_intent: pi, limit: 100 });
  for (const r of list.data || []) {
    if (r.status !== 'succeeded' && r.status !== 'pending') continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    if (await Refund.count({ where: { stripeRefundId: r.id } })) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await recordRefund(payment.id, {
      amount: cents(D(r.amount).div(100)), method: 'stripe', stripeRefundId: r.id, reason: 'Refunded in Stripe', strict: false,
    });
  }
}

async function handleStripeEvent(event) {
  const obj = event && event.data && event.data.object;
  if (!obj) return;
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required') await succeededSession(obj, 'card');
      else await pendingSession(obj);
      break;
    case 'checkout.session.async_payment_succeeded':
      await succeededSession(obj, 'us_bank_account');
      break;
    case 'checkout.session.async_payment_failed':
      await failedSession(obj);
      break;
    case 'charge.refunded':
      await refundedCharge(obj);
      break;
    default:
  }
}

function paymentJson(p) {
  return {
    id: p.id,
    companyId: p.companyId,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoice ? p.invoice.number : undefined,
    company: p.company ? { id: p.company.id, name: p.company.name } : undefined,
    method: p.method,
    status: p.status,
    amount: cents(p.amount),
    appliedAmount: cents(p.appliedAmount),
    creditAmount: cents(p.creditAmount),
    surcharge: cents(p.surcharge),
    fee: cents(p.fee),
    refundedAmount: cents(p.refundedAmount),
    receivedOn: p.receivedOn,
    reference: p.reference,
    createdAt: p.createdAt,
  };
}

module.exports = {
  HAND_METHODS, recordPayment, applyCredit, refundCredit, refundPayment, recordRefund, creditBalance,
  issuePayToken, newPayToken, savePayToken, invoiceByPayToken, createCheckout, handleStripeEvent, paymentJson, settledStatus,
};
