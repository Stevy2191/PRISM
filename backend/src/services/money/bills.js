// Bills (Phase 3, step 2): what contractors and suppliers charge. A bill is
// received, then entered (owed: Dr cost / Cr Accounts payable), then paid
// (Dr Accounts payable / Cr Cash), or voided (whatever was posted is
// reversed). Lines may name the tickets and projects the work was for.
const { Op } = require('sequelize');
const {
  Bill, BillLine, Company, Ticket, Project, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const {
  parseRecordId, findAccessibleTicket, findAccessibleProject,
} = require('../permissionService');
const { D, cents, sum } = require('./money');
const ledger = require('./ledger');
const { findTicketIdByNumber } = require('../tickets/numbers');

const KINDS = ['contractor', 'materials', 'stock', 'expense'];
const EXPENSE_ACCOUNTS = ['6100', '6200', '6300', '6900'];
const ACCOUNT_FOR = { contractor: '5100', materials: '5000', stock: '1200' };
const PAY_METHODS = ['check', 'ach', 'card', 'cash', 'other'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const conflict = (message) => new ApiError(409, message, 'BILL_STATE');

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function text(raw, label, max, required = false) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s || null;
}
function amount(raw, label) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || D(s).isZero()) throw bad(`${label} must be an amount over 0, like 1250 or 99.50`);
  return cents(s);
}

async function loadVendor(rawId) {
  const vendor = await Company.findByPk(parseRecordId(rawId) || 0);
  if (!vendor || !vendor.isVendor) throw bad('Choose a vendor');
  return vendor;
}

// Lines as given, checked: kinds, amounts, accounts, and jobs the caller can reach.
async function readLines(rawLines, user) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw bad('A bill needs at least one line');
  if (rawLines.length > 200) throw bad('A bill can have at most 200 lines');
  const out = [];
  for (const [i, l] of rawLines.entries()) {
    const n = `Line ${i + 1}`;
    if (!KINDS.includes(l.kind)) throw bad(`${n}: choose contractor, materials, stock or expense`);
    const line = {
      kind: l.kind,
      description: text(l.description, `${n}'s description`, 500, true),
      amount: amount(l.amount, `${n}'s amount`),
      expenseAccount: null,
      ticketId: null,
      projectId: null,
    };
    if (l.kind === 'expense') {
      if (!EXPENSE_ACCOUNTS.includes(String(l.expenseAccount))) throw bad(`${n}: choose what kind of expense it is`);
      line.expenseAccount = String(l.expenseAccount);
    }
    if (l.ticketId) {
      // eslint-disable-next-line no-await-in-loop
      const t = await findAccessibleTicket(user, (await findTicketIdByNumber(l.ticketId)) || 0); // WC-T0042 or its id
      if (!t) throw bad(`${n}: ticket not found`);
      line.ticketId = t.id;
    }
    if (l.projectId) {
      // eslint-disable-next-line no-await-in-loop
      const p = await findAccessibleProject(user, parseRecordId(l.projectId) || 0);
      if (!p) throw bad(`${n}: project not found`);
      line.projectId = p.id;
    }
    out.push(line);
  }
  return out;
}

function checkTotal(total, lines) {
  if (D(total).equals(sum(lines.map((l) => l.amount)))) return;
  throw bad(`The lines add up to ${cents(sum(lines.map((l) => l.amount)))}, not the bill's total of ${total}`);
}

async function assertNumberFree(vendorCompanyId, billNumber, excludeId = null) {
  const clash = await Bill.findOne({ where: { vendorCompanyId, billNumber, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) } });
  if (clash) throw new ApiError(409, 'This vendor already has a bill with that number', 'BILL_NUMBER_TAKEN');
}

const include = [
  { model: BillLine, as: 'lines' },
  { model: Company, as: 'vendor', attributes: ['id', 'name', 'is1099'] },
];
const load = (id, options = {}) => Bill.findByPk(id, { include, order: [[{ model: BillLine, as: 'lines' }, 'id', 'ASC']], ...options });

// POST: { vendorCompanyId, billNumber, billDate, dueDate?, total, notes?, lines }
async function createBill(input, user) {
  const vendor = await loadVendor(input.vendorCompanyId);
  const billNumber = text(input.billNumber, 'The bill number', 100, true);
  if (!isDate(input.billDate)) throw bad('The bill date must be a date like 2026-12-01');
  if (input.dueDate != null && input.dueDate !== '' && !isDate(input.dueDate)) throw bad('The due date must be a date like 2026-12-31');
  const total = amount(input.total, 'The total');
  const lines = await readLines(input.lines, user);
  checkTotal(total, lines);
  await assertNumberFree(vendor.id, billNumber);
  const bill = await sequelize.transaction(async (transaction) => {
    const made = await Bill.create({
      vendorCompanyId: vendor.id, billNumber, billDate: input.billDate, dueDate: input.dueDate || null, total, notes: text(input.notes, 'Notes', 5000), createdBy: user.id,
    }, { transaction });
    await BillLine.bulkCreate(lines.map((l) => ({ ...l, billId: made.id })), { transaction });
    return made;
  });
  return load(bill.id);
}

// PATCH while received: anything; after: only notes.
async function updateBill(bill, input, user) {
  const changes = {};
  if (input.notes !== undefined) changes.notes = text(input.notes, 'Notes', 5000);
  const other = ['vendorCompanyId', 'billNumber', 'billDate', 'dueDate', 'total', 'lines'].filter((k) => input[k] !== undefined);
  if (other.length && bill.status !== 'received') throw conflict('Only the notes of an entered bill can change; void it and enter it again');
  if (input.vendorCompanyId !== undefined) changes.vendorCompanyId = (await loadVendor(input.vendorCompanyId)).id;
  if (input.billNumber !== undefined) changes.billNumber = text(input.billNumber, 'The bill number', 100, true);
  if (input.billDate !== undefined) {
    if (!isDate(input.billDate)) throw bad('The bill date must be a date like 2026-12-01');
    changes.billDate = input.billDate;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate !== null && input.dueDate !== '' && !isDate(input.dueDate)) throw bad('The due date must be a date like 2026-12-31');
    changes.dueDate = input.dueDate || null;
  }
  const lines = input.lines !== undefined ? await readLines(input.lines, user) : null;
  const total = input.total !== undefined ? amount(input.total, 'The total') : cents(bill.total);
  if (lines) checkTotal(total, lines);
  else if (input.total !== undefined) checkTotal(total, bill.lines.map((l) => ({ amount: l.amount })));
  if (input.total !== undefined) changes.total = total;
  if (changes.billNumber || changes.vendorCompanyId) {
    await assertNumberFree(changes.vendorCompanyId || bill.vendorCompanyId, changes.billNumber || bill.billNumber, bill.id);
  }
  await sequelize.transaction(async (transaction) => {
    // Checked again under the lock: an enter racing this edit wins cleanly.
    const locked = await Bill.findByPk(bill.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (other.length && locked.status !== 'received') throw conflict('Only the notes of an entered bill can change; void it and enter it again');
    await locked.update(changes, { transaction });
    if (lines) {
      await BillLine.destroy({ where: { billId: bill.id }, transaction });
      await BillLine.bulkCreate(lines.map((l) => ({ ...l, billId: bill.id })), { transaction });
    }
  });
  return load(bill.id);
}

// The company the bill's entries are filed under: the jobs' one company, if
// they share one.
async function companyOfLines(lines, transaction) {
  const ids = new Set();
  for (const l of lines) {
    /* eslint-disable no-await-in-loop */
    if (l.ticketId) ids.add((await Ticket.findByPk(l.ticketId, { attributes: ['companyId'], transaction }))?.companyId);
    if (l.projectId) ids.add((await Project.findByPk(l.projectId, { attributes: ['companyId'], transaction }))?.companyId);
    /* eslint-enable no-await-in-loop */
  }
  ids.delete(undefined);
  return ids.size === 1 ? [...ids][0] : null;
}

async function lockBill(bill, transaction) {
  return Bill.findByPk(bill.id, { include: [{ model: BillLine, as: 'lines' }], transaction, lock: transaction.LOCK.UPDATE });
}

// received → entered: owed. Posts Dr cost / Cr Accounts payable.
async function enterBill(bill, { externalRef = undefined } = {}, user) {
  await sequelize.transaction(async (transaction) => {
    const b = await lockBill(bill, transaction);
    if (b.status !== 'received') throw conflict(`This bill is already ${b.status}`);
    const vendor = await Company.findByPk(b.vendorCompanyId, { attributes: ['name'], transaction });
    const debits = new Map();
    b.lines.forEach((l) => {
      const account = l.kind === 'expense' ? l.expenseAccount : ACCOUNT_FOR[l.kind];
      debits.set(account, sum([debits.get(account) || 0, l.amount]));
    });
    const entry = await ledger.postEntry({
      date: b.billDate,
      memo: `Bill ${b.billNumber}, ${vendor.name}`,
      sourceType: 'bill',
      sourceId: b.id,
      companyId: await companyOfLines(b.lines, transaction),
      lines: [
        ...[...debits].map(([account, amt]) => ({ account, debit: cents(amt) })),
        { account: '2000', credit: cents(b.total) },
      ],
    }, { transaction, userId: user.id });
    await b.update({
      status: 'entered', ledgerEntryId: entry.id, ...(externalRef !== undefined ? { externalRef: text(externalRef, 'The reference', 100) } : {}),
    }, { transaction });
  });
  return load(bill.id);
}

// entered → paid. Posts Dr Accounts payable / Cr Cash on the paid date.
async function payBill(bill, { paidOn, paidMethod, paidRef } = {}, user) {
  if (!isDate(paidOn)) throw bad('The paid date must be a date like 2026-12-15');
  if (!PAY_METHODS.includes(paidMethod)) throw bad(`How it was paid: ${PAY_METHODS.join(', ')}`);
  await sequelize.transaction(async (transaction) => {
    const b = await lockBill(bill, transaction);
    if (b.status !== 'entered') throw conflict(b.status === 'paid' ? 'This bill is already paid' : `A ${b.status} bill can't be paid; enter it first`);
    const entry = await ledger.postEntry({
      date: paidOn,
      memo: `Paid bill ${b.billNumber}`,
      sourceType: 'bill_payment',
      sourceId: b.id,
      companyId: await companyOfLines(b.lines, transaction),
      lines: [{ account: '2000', debit: cents(b.total) }, { account: '1000', credit: cents(b.total) }],
    }, { transaction, userId: user.id });
    await b.update({
      status: 'paid', paidOn, paidMethod, paidRef: text(paidRef, 'The payment reference', 100), paymentEntryId: entry.id,
    }, { transaction });
  });
  return load(bill.id);
}

// Any state → void; reverses the payment and the bill entries if posted.
async function voidBill(bill, { reason } = {}, user, today) {
  await sequelize.transaction(async (transaction) => {
    const b = await lockBill(bill, transaction);
    if (b.status === 'void') throw conflict('This bill is already void');
    if (b.paymentEntryId) await ledger.reverseEntry(b.paymentEntryId, { date: today, memo: `Void payment of bill ${b.billNumber}`, transaction, userId: user.id });
    if (b.ledgerEntryId) await ledger.reverseEntry(b.ledgerEntryId, { date: today, memo: `Void bill ${b.billNumber}`, transaction, userId: user.id });
    await b.update({ status: 'void', voidReason: text(reason, 'The reason', 255) }, { transaction });
  });
  return load(bill.id);
}

function billJson(bill, { canSeeAmounts = true } = {}) {
  const plain = bill.get({ plain: true });
  const out = {
    ...plain,
    total: cents(plain.total),
    lines: (plain.lines || []).map((l) => ({ ...l, amount: cents(l.amount) })),
  };
  delete out.filePath;
  if (!canSeeAmounts) {
    delete out.total;
    out.lines = out.lines.map(({ amount: drop, ...rest }) => rest); // eslint-disable-line no-unused-vars
  }
  return out;
}

module.exports = {
  KINDS, EXPENSE_ACCOUNTS, PAY_METHODS, createBill, updateBill, enterBill, payBill, voidBill, billJson, load,
};
