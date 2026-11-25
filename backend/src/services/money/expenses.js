// Expenses (Phase 3, step 2): what the team paid for directly, with its
// receipt. Recorded = paid: Dr the expense account / Cr Cash, in one
// transaction with the row. Never edited in amount; voided by reversal.
// An expense for a job may be billed on to the customer (unbilled → billed
// by invoicing, step 3); a billed expense can't be voided.
const { Op } = require('sequelize');
const {
  Expense, Company, Ticket, Project, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId, findAccessibleTicket, findAccessibleProject } = require('../permissionService');
const { D, cents } = require('./money');
const ledger = require('./ledger');
const { findTicketIdByNumber } = require('../tickets/numbers');

const ACCOUNTS = ['6100', '6200', '6300', '6900'];
const PAY_METHODS = ['card', 'cash', 'check', 'ach', 'reimbursed', 'other'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const conflict = (message) => new ApiError(409, message, 'EXPENSE_STATE');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function description(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw bad('Say what it was for');
  if (s.length > 500) throw bad('The description is too long');
  return s;
}

async function job(input, user) {
  if (input.ticketId && input.projectId) throw bad('An expense is for a ticket or a project, not both');
  if (input.ticketId) {
    const t = await findAccessibleTicket(user, (await findTicketIdByNumber(input.ticketId)) || 0); // WC-T0042 or its id
    if (!t) throw bad('Ticket not found');
    return { ticketId: t.id, projectId: null, companyId: t.companyId };
  }
  if (input.projectId) {
    const p = await findAccessibleProject(user, parseRecordId(input.projectId) || 0);
    if (!p) throw bad('Project not found');
    return { ticketId: null, projectId: p.id, companyId: p.companyId };
  }
  return { ticketId: null, projectId: null, companyId: null };
}

// recordExpense({ spentOn, account, description, amount, paymentMethod, vendorCompanyId?, ticketId? | projectId?, rebillable? }, user)
async function recordExpense(input, user) {
  if (!isDate(input.spentOn)) throw bad('When was it spent? Use a date like 2026-12-03');
  const account = String(input.account ?? '');
  if (!ACCOUNTS.includes(account)) throw bad('Choose what kind of expense it is');
  const desc = description(input.description);
  const amt = String(input.amount ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(amt) || D(amt).isZero()) throw bad('The amount must be over 0, like 62.40');
  const paymentMethod = String(input.paymentMethod ?? '');
  if (!PAY_METHODS.includes(paymentMethod)) throw bad(`Choose how it was paid: ${PAY_METHODS.join(', ')}`);
  let vendorCompanyId = null;
  if (input.vendorCompanyId) {
    const vendor = await Company.findByPk(parseRecordId(input.vendorCompanyId) || 0);
    if (!vendor || !vendor.isVendor) throw bad('Choose a vendor');
    vendorCompanyId = vendor.id;
  }
  const where = await job(input, user);
  const rebillable = input.rebillable === true;
  if (rebillable && !where.ticketId && !where.projectId) throw bad('To bill it on, put it on the customer\'s ticket or project');

  const id = await sequelize.transaction(async (transaction) => {
    const e = await Expense.create({
      spentOn: input.spentOn,
      account,
      description: desc,
      amount: cents(amt),
      paymentMethod,
      vendorCompanyId,
      ticketId: where.ticketId,
      projectId: where.projectId,
      rebillable,
      billingStatus: rebillable ? 'unbilled' : 'non_billable',
      createdBy: user.id,
    }, { transaction });
    const entry = await ledger.postEntry({
      date: e.spentOn,
      memo: `Expense: ${desc}`.slice(0, 255),
      sourceType: 'expense',
      sourceId: e.id,
      companyId: where.companyId,
      lines: [{ account, debit: cents(amt) }, { account: '1000', credit: cents(amt) }],
    }, { transaction, userId: user.id });
    await e.update({ ledgerEntryId: entry.id }, { transaction });
    return e.id;
  });
  return Expense.findByPk(id);
}

// Only the description (and the receipt, separately) change; anything about
// the money is a void and a new expense.
const FIXED = ['spentOn', 'account', 'amount', 'paymentMethod', 'vendorCompanyId', 'ticketId', 'projectId', 'rebillable'];
async function updateExpense(expense, input) {
  const changed = FIXED.filter((k) => input[k] !== undefined);
  if (changed.length) throw bad('To change the money, void this expense and record it again');
  if (expense.voided) throw conflict('This expense is void');
  if (input.description !== undefined) await expense.update({ description: description(input.description) });
  return expense.reload();
}

async function voidExpense(expense, { reason } = {}, user, today) {
  await sequelize.transaction(async (transaction) => {
    const e = await Expense.findByPk(expense.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (e.voided) throw conflict('This expense is already void');
    if (e.billingStatus === 'billed') throw conflict('This expense is on an invoice; void the invoice line first');
    if (e.ledgerEntryId) await ledger.reverseEntry(e.ledgerEntryId, { date: today, memo: `Void expense: ${e.description}`.slice(0, 255), transaction, userId: user.id });
    await e.update({ voided: true, voidReason: reason ? String(reason).trim().slice(0, 255) : null, billingStatus: e.billingStatus === 'unbilled' ? 'non_billable' : e.billingStatus }, { transaction });
  });
  return Expense.findByPk(expense.id);
}

function expenseJson(expense) {
  const plain = expense.get({ plain: true });
  const out = { ...plain, amount: cents(plain.amount), hasReceipt: Boolean(plain.receiptFile) };
  delete out.receiptFile;
  return out;
}

function listWhere(q) {
  const where = {};
  if (ACCOUNTS.includes(q.account)) where.account = q.account;
  if (q.ticketId) where.ticketId = parseRecordId(q.ticketId) || -1;
  if (q.projectId) where.projectId = parseRecordId(q.projectId) || -1;
  if (q.vendorCompanyId) where.vendorCompanyId = parseRecordId(q.vendorCompanyId) || -1;
  if (['unbilled', 'billed', 'non_billable'].includes(q.billingStatus)) where.billingStatus = q.billingStatus;
  if (q.voided !== 'true') where.voided = false;
  if (isDate(q.from) || isDate(q.to)) where.spentOn = { ...(isDate(q.from) ? { [Op.gte]: q.from } : {}), ...(isDate(q.to) ? { [Op.lte]: q.to } : {}) };
  return where;
}

module.exports = {
  ACCOUNTS, PAY_METHODS, recordExpense, updateExpense, voidExpense, expenseJson, listWhere,
};
