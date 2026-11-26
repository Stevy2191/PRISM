// Invoice reminders and late fees (Phase 3, step 3). Hourly, with dates in
// the organization's time zone, while Customer billing is on:
//   - a reminder some days before the due date ('before'), then at each
//     number of days late ('late7', 'late30'); each at most once per
//     invoice. When several are due at once (PRISM was down), only the
//     latest goes, and the earlier ones are counted as sent.
//   - a late fee, when one is set (off by default): once per invoice, its
//     own small invoice (a 'late_fee' line), sent and emailed, so a sent
//     invoice is never changed.
// Only open invoices (sent or partly paid) are reminded or charged.
const { Op } = require('sequelize');
const { Invoice, Company, sequelize } = require('../../models');
const { orgToday, addDays } = require('../../utils/orgTime');
const { D, cents } = require('./money');
const { moneyConfig } = require('./config');
const invoices = require('./invoices');
const { emailInvoice } = require('./invoiceMail');

const OPEN = ['sent', 'partly_paid'];

// The stages due on `today` for an invoice due on `dueOn`, oldest first.
function stagesDue(dueOn, today, cfg) {
  const out = [];
  if (cfg.reminderDaysBefore > 0 && today >= addDays(dueOn, -cfg.reminderDaysBefore) && today < dueOn) out.push('before');
  cfg.reminderDaysLate.forEach((n) => { if (today >= addDays(dueOn, n)) out.push(`late${n}`); });
  return out;
}

async function sendDueReminders({ today } = {}) {
  const cfg = await moneyConfig();
  const day = today || await orgToday();
  const open = await Invoice.findAll({
    where: {
      kind: 'invoice', status: OPEN, dueOn: { [Op.ne]: null }, issuedOn: { [Op.lte]: day },
    },
    order: [['dueOn', 'ASC'], ['id', 'ASC']],
  });
  const sent = [];
  for (const inv of open) {
    const due = stagesDue(inv.dueOn, day, cfg);
    const done = new Set(inv.remindersSent);
    const pending = due.filter((s) => !done.has(s));
    if (!pending.length) continue; // eslint-disable-line no-continue
    const stage = pending[pending.length - 1];
    // Claimed before sending, under a lock, so two runs never both send it.
    // eslint-disable-next-line no-await-in-loop
    const claimed = await sequelize.transaction(async (t) => {
      const row = await Invoice.findByPk(inv.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!OPEN.includes(row.status) || row.remindersSent.includes(stage)) return false;
      await row.update({ remindersSent: [...new Set([...row.remindersSent, ...due])] }, { transaction: t });
      return true;
    });
    if (!claimed) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const delivery = await emailInvoice(await invoices.load(inv.id), { template: stage === 'before' ? 'invoice_reminder_due' : 'invoice_reminder_late' });
    sent.push({ invoiceId: inv.id, stage, emailed: delivery.emailed });
  }
  return { sent };
}

async function applyLateFees({ today } = {}) {
  const cfg = await moneyConfig();
  const charged = [];
  if (cfg.lateFeeType === 'none' || !D(cfg.lateFeeAmount).gt(0)) return { charged };
  const day = today || await orgToday();
  const overdue = await Invoice.findAll({
    where: {
      kind: 'invoice', status: OPEN, lateFeeInvoiceId: null, dueOn: { [Op.lte]: addDays(day, -cfg.lateFeeAfterDays) },
    },
    order: [['dueOn', 'ASC'], ['id', 'ASC']],
  });
  for (const inv of overdue) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sequelize.transaction(async (t) => {
      const row = await Invoice.findByPk(inv.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!OPEN.includes(row.status) || row.lateFeeInvoiceId) return null;
      const owed = D(invoices.balanceOf(row));
      const amount = cfg.lateFeeType === 'flat' ? cents(cfg.lateFeeAmount) : cents(owed.times(cfg.lateFeeAmount).div(100));
      if (!D(amount).gt(0)) return null;
      const company = await Company.findByPk(row.companyId, { transaction: t });
      const fee = await invoices.createDraft(company, {
        lines: [{ kind: 'late_fee', description: `Late fee on ${row.number} (due ${row.dueOn})`, quantity: '1', unitPrice: amount }],
        billToContactId: row.billToContactId,
        notes: `Late fee on invoice ${row.number}.`,
      }, { transaction: t });
      const sent = await invoices.sendInvoice(fee, { issuedOn: day, transaction: t });
      await row.update({ lateFeeInvoiceId: sent.id }, { transaction: t });
      return { invoiceId: row.id, feeInvoiceId: sent.id, amount };
    });
    if (result) {
      charged.push(result);
      await emailInvoice(await invoices.load(result.feeInvoiceId)); // eslint-disable-line no-await-in-loop
    }
  }
  return { charged };
}

async function runReminders({ today } = {}) {
  if (!(await moneyConfig()).customerBilling) return { ran: false };
  const day = today || await orgToday();
  const reminded = await sendDueReminders({ today: day });
  const fees = await applyLateFees({ today: day });
  return { ran: true, ...reminded, ...fees };
}

let started = false;
function startReminderScheduler() {
  if (started) return;
  started = true;
  const tick = () => runReminders().catch((err) => console.error('[reminders] run failed:', err));
  tick();
  setInterval(tick, 60 * 60 * 1000);
  console.log('[reminders] scheduler started (checking hourly)');
}

module.exports = {
  stagesDue, sendDueReminders, applyLateFees, runReminders, startReminderScheduler,
};
