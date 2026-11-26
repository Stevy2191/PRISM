// Invoices (Phase 3, step 3). A draft gathers lines; whatever a line bills
// (time, materials, rebilled expenses) is claimed by it and locked, so
// nothing is billed twice. Amounts and tax are always worked out here, per
// line, and the lines add up to the totals. Sending gives the next number,
// the due date from the terms, and posts Dr A/R / Cr income and sales tax.
// A sent invoice is never edited: it is voided (reversed, its items freed)
// or credited with a credit note (Dr income and tax / Cr customer credit).
const { Op } = require('sequelize');
const {
  Invoice, InvoiceLine, TimeEntry, ProjectMaterial, Expense, Ticket, Project, Contact, Agreement,
  TaxCategory, SystemSettings, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId } = require('../permissionService');
const { orgToday, addDays } = require('../../utils/orgTime');
const { D, cents, unit } = require('./money');
const { customerBilling, taxForLines } = require('./tax');
const { DEFAULTS, moneyConfig } = require('./config');
const ledger = require('./ledger');

const KINDS = InvoiceLine.KINDS;
// Where each kind of line's income is booked.
const INCOME = {
  agreement: '4000', license: '4000', prepaid_hours: '4000',
  labor: '4100', after_hours: '4100', trip: '4100', overage: '4100',
  material: '4200', expense: '4300', fee: '4300', late_fee: '4300', covered: null,
};
// A line given no tax category takes the seeded one for its kind (never
// none: a missed category must not undercharge tax).
const DEFAULT_CATEGORY = {
  agreement: 'Managed services', license: 'Licenses', prepaid_hours: 'Managed services',
  labor: 'Remote support', after_hours: 'Remote support', overage: 'Remote support', trip: 'On-site labor',
  material: 'Parts and equipment', expense: 'Parts and equipment', fee: 'Fees', late_fee: 'Fees', covered: 'Fees',
};
const MAX_LINES = 500;

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const state = (message, code = 'INVOICE_STATE') => new ApiError(409, message, code);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function text(raw, label, max, required = false) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s || null;
}
function decimal(raw, label, { positive = false } = {}) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(s) || (positive && D(s).isZero())) throw bad(`${label} must be a number${positive ? ' over 0' : ' of 0 or more'}`);
  return unit(s);
}
function ids(raw, label) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 1000) throw bad(`${label} must be a list`);
  const out = raw.map((x) => parseRecordId(x));
  if (out.some((x) => !x)) throw bad(`${label} must be record ids`);
  return [...new Set(out)];
}

async function defaultCategoryId(kind) {
  const row = await TaxCategory.findOne({ where: { name: DEFAULT_CATEGORY[kind], active: true }, attributes: ['id'] });
  return row ? row.id : null;
}

// Lines as given, checked. Items (timeEntryIds, materialIds, expenseIds)
// only where allowed (drafts, not credit notes).
async function readLines(rawLines, { items = true } = {}) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw bad('An invoice needs at least one line');
  if (rawLines.length > MAX_LINES) throw bad(`An invoice can have at most ${MAX_LINES} lines`);
  const known = new Set((await TaxCategory.findAll({ attributes: ['id'] })).map((c) => c.id));
  const out = [];
  for (const [i, l] of rawLines.entries()) {
    const n = `Line ${i + 1}`;
    if (!KINDS.includes(l.kind)) throw bad(`${n}: unknown kind of line`);
    const line = {
      kind: l.kind,
      description: text(l.description, `${n}'s description`, 500, true),
      quantity: decimal(l.quantity ?? '1', `${n}'s quantity`, { positive: l.kind !== 'covered' }),
      unitPrice: l.kind === 'covered' ? unit(0) : decimal(l.unitPrice, `${n}'s price`),
      taxCategoryId: null,
      ticketId: l.ticketId ? parseRecordId(l.ticketId) : null,
      projectId: l.projectId ? parseRecordId(l.projectId) : null,
      agreementLineId: l.agreementLineId ? parseRecordId(l.agreementLineId) : null,
      serviceFrom: isDate(l.serviceFrom) ? l.serviceFrom : null,
      serviceTo: isDate(l.serviceTo) ? l.serviceTo : null,
      sortOrder: i,
      items: {
        timeEntryIds: items ? ids(l.timeEntryIds, `${n}'s time`) : [],
        materialIds: items ? ids(l.materialIds, `${n}'s materials`) : [],
        expenseIds: items ? ids(l.expenseIds, `${n}'s expenses`) : [],
      },
    };
    if (l.taxCategoryId !== undefined && l.taxCategoryId !== null && l.taxCategoryId !== '') {
      line.taxCategoryId = parseRecordId(l.taxCategoryId);
      if (!known.has(line.taxCategoryId)) throw bad(`${n}: tax category not found`);
    } else {
      line.taxCategoryId = await defaultCategoryId(l.kind); // eslint-disable-line no-await-in-loop
      if (!line.taxCategoryId) throw bad(`${n}: choose a tax category`);
    }
    if (line.kind === 'covered' && (line.items.materialIds.length || line.items.expenseIds.length)) throw bad(`${n}: only time can be covered`);
    out.push(line);
  }
  return out;
}

// { ticketId → companyId } and { projectId → companyId } for the rows given.
async function jobCompanies(rows, transaction) {
  const ticketIds = [...new Set(rows.map((r) => r.ticketId).filter(Boolean))];
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))];
  const [tickets, projects] = await Promise.all([
    ticketIds.length ? Ticket.findAll({ where: { id: ticketIds }, attributes: ['id', 'companyId'], transaction }) : [],
    projectIds.length ? Project.findAll({ where: { id: projectIds }, attributes: ['id', 'companyId'], transaction }) : [],
  ]);
  const t = new Map(tickets.map((x) => [x.id, x.companyId]));
  const p = new Map(projects.map((x) => [x.id, x.companyId]));
  return (row) => (row.ticketId ? t.get(row.ticketId) : p.get(row.projectId));
}

const ITEM_MODELS = [
  ['timeEntryIds', TimeEntry, 'time entry', (r) => r.billable],
  ['materialIds', ProjectMaterial, 'material', (r) => r.billable],
  ['expenseIds', Expense, 'expense', (r) => r.rebillable && !r.voided],
];

// Claims what a line bills: each row locked, of this company, still unbilled.
async function claimItems(line, items, { companyId, transaction }) {
  for (const [key, Model, label, billable] of ITEM_MODELS) {
    const wanted = items[key] || [];
    if (!wanted.length) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const rows = await Model.findAll({ where: { id: wanted }, transaction, lock: transaction.LOCK.UPDATE });
    if (rows.length !== wanted.length) throw bad(`A ${label} on line ${line.sortOrder + 1} was not found`);
    const companyOf = await jobCompanies(rows, transaction); // eslint-disable-line no-await-in-loop
    if (rows.some((r) => companyOf(r) !== companyId)) throw bad(`A ${label} on line ${line.sortOrder + 1} is another customer's`);
    if (rows.some((r) => r.billingStatus !== 'unbilled' || !billable(r))) {
      throw new ApiError(409, `A ${label} on line ${line.sortOrder + 1} is already billed, or isn't billable`, 'ALREADY_BILLED');
    }
    const billingStatus = line.kind === 'covered' ? 'covered' : 'billed';
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ billingStatus, invoiceLineId: line.id }, { where: { id: wanted }, transaction, allowBilled: true });
  }
}

// Frees everything the given invoice lines billed.
async function releaseItems(lineIds, transaction) {
  if (!lineIds.length) return;
  for (const [, Model] of ITEM_MODELS) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ billingStatus: 'unbilled', invoiceLineId: null }, { where: { invoiceLineId: lineIds }, transaction, allowBilled: true });
  }
}

async function assertLinesOfCompany(lines, companyId, transaction) {
  const companyOf = await jobCompanies(lines, transaction);
  if (lines.some((l) => (l.ticketId || l.projectId) && companyOf(l) !== companyId)) throw bad('A line names another customer\'s ticket or project');
}

async function createLines(invoice, lines, transaction) {
  await assertLinesOfCompany(lines, invoice.companyId, transaction);
  for (const l of lines) {
    const { items, ...fields } = l;
    // eslint-disable-next-line no-await-in-loop
    const row = await InvoiceLine.create({ ...fields, invoiceId: invoice.id }, { transaction });
    await claimItems(row, items, { companyId: invoice.companyId, transaction }); // eslint-disable-line no-await-in-loop
  }
}

// Works every line's amount and tax out again, and the totals from them.
async function recompute(invoice, { transaction, onDate = null } = {}) {
  const lines = await InvoiceLine.findAll({ where: { invoiceId: invoice.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']], transaction });
  const billing = { ...(await customerBilling(invoice.companyId)), chargeTax: invoice.chargeTax };
  const categories = await TaxCategory.findAll({ where: { id: [...new Set(lines.map((l) => l.taxCategoryId))] }, transaction });
  const amounts = lines.map((l) => (l.kind === 'covered' ? cents(0) : cents(D(l.quantity).times(l.unitPrice))));
  const today = onDate || invoice.issuedOn || await orgToday();
  const tax = taxForLines(lines.map((l, i) => ({ amount: amounts[i], taxCategoryId: l.taxCategoryId })), billing, { categories, onDate: today });
  for (const [i, l] of lines.entries()) {
    if (cents(l.amount) !== amounts[i] || cents(l.tax) !== tax.lines[i].tax) {
      await l.update({ amount: amounts[i], tax: tax.lines[i].tax }, { transaction }); // eslint-disable-line no-await-in-loop
    }
  }
  const subtotal = amounts.reduce((s, x) => s.plus(x), D(0));
  await invoice.update({ subtotal: cents(subtotal), taxTotal: tax.taxTotal, total: cents(subtotal.plus(tax.taxTotal)) }, { transaction });
  return invoice;
}

async function readBillTo(raw, companyId) {
  if (raw === undefined || raw === null || raw === '') return null;
  const contact = await Contact.findByPk(parseRecordId(raw) || 0, { attributes: ['id', 'companyId'] });
  if (!contact || contact.companyId !== companyId) throw bad('Bill to: choose one of the customer\'s contacts');
  return contact.id;
}

// The next number of a sequence, under a row lock: no two invoices share one.
async function nextNumber(kind, transaction) {
  const [counterKey, prefixKey] = kind === 'credit_note'
    ? ['money.creditNoteNextNumber', 'money.creditNotePrefix'] : ['money.invoiceNextNumber', 'money.invoicePrefix'];
  await SystemSettings.findOrCreate({ where: { key: counterKey }, defaults: { value: DEFAULTS[counterKey] }, transaction });
  const row = await SystemSettings.findByPk(counterKey, { transaction, lock: transaction.LOCK.UPDATE });
  const n = Number(row.value) || Number(DEFAULTS[counterKey]);
  await row.update({ value: String(n + 1) }, { transaction });
  const cfg = await moneyConfig();
  const prefix = prefixKey === 'money.creditNotePrefix' ? cfg.creditNotePrefix : cfg.invoicePrefix;
  return `${prefix}${n}`;
}

const inTransaction = (transaction, fn) => (transaction ? fn(transaction) : sequelize.transaction(fn));

async function load(id, options = {}) {
  return Invoice.findByPk(id, {
    include: [
      { model: InvoiceLine, as: 'lines' },
      { model: Invoice, as: 'creditNotes', attributes: ['id', 'number', 'total', 'status', 'issuedOn'] },
    ],
    order: [[{ model: InvoiceLine, as: 'lines' }, 'sortOrder', 'ASC'], [{ model: InvoiceLine, as: 'lines' }, 'id', 'ASC']],
    ...options,
  });
}

// body: { lines, notes?, chargeTax?, billToContactId?, agreementId?, periodKey?, ticketId? }
async function createDraft(company, body, { userId = null, transaction = null } = {}) {
  const lines = await readLines(body.lines);
  const billing = await customerBilling(company.id);
  const fields = {
    kind: 'invoice',
    companyId: company.id,
    status: 'draft',
    chargeTax: typeof body.chargeTax === 'boolean' ? body.chargeTax : billing.chargeTax,
    notes: text(body.notes, 'Notes', 5000),
    billToContactId: await readBillTo(body.billToContactId, company.id),
    agreementId: body.agreementId || null,
    periodKey: body.periodKey || null,
    ticketId: body.ticketId || null,
    createdBy: userId,
  };
  const id = await inTransaction(transaction, async (t) => {
    const invoice = await Invoice.create(fields, { transaction: t });
    await createLines(invoice, lines, t);
    await recompute(invoice, { transaction: t });
    return invoice.id;
  });
  return load(id, { transaction });
}

async function lockedDraft(invoice, transaction) {
  const row = await Invoice.findByPk(invoice.id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!row || row.status !== 'draft') throw state('Only a draft can be changed. Void it, or issue a credit note.');
  return row;
}
const lineIdsOf = async (invoiceId, transaction) => (await InvoiceLine.findAll({ where: { invoiceId }, attributes: ['id'], transaction })).map((l) => l.id);

async function updateDraft(invoice, body) {
  const lines = body.lines !== undefined ? await readLines(body.lines) : null;
  await sequelize.transaction(async (t) => {
    const row = await lockedDraft(invoice, t);
    const fields = {};
    if (body.notes !== undefined) fields.notes = text(body.notes, 'Notes', 5000);
    if (body.chargeTax !== undefined) {
      if (typeof body.chargeTax !== 'boolean') throw bad('Charge tax must be true or false');
      fields.chargeTax = body.chargeTax;
    }
    if (body.billToContactId !== undefined) fields.billToContactId = await readBillTo(body.billToContactId, row.companyId);
    await row.update(fields, { transaction: t });
    if (lines) {
      const old = await lineIdsOf(row.id, t);
      await releaseItems(old, t);
      await InvoiceLine.destroy({ where: { invoiceId: row.id }, transaction: t });
      await createLines(row, lines, t);
    }
    await recompute(row, { transaction: t });
  });
  return load(invoice.id);
}

async function deleteDraft(invoice) {
  await sequelize.transaction(async (t) => {
    const row = await lockedDraft(invoice, t);
    await releaseItems(await lineIdsOf(row.id, t), t);
    await row.destroy({ transaction: t });
  });
}

// Dr/Cr lines for an invoice's (or, reversed, a credit note's) amounts.
function postingLines(lines, taxTotal, total, { credit = false } = {}) {
  const byAccount = new Map();
  lines.forEach((l) => {
    const account = INCOME[l.kind];
    if (!account || D(l.amount).isZero()) return;
    byAccount.set(account, (byAccount.get(account) || D(0)).plus(l.amount));
  });
  const side = credit ? 'debit' : 'credit';
  const out = [...byAccount.entries()].map(([account, amt]) => ({ account, [side]: cents(amt) }));
  if (!D(taxTotal).isZero()) out.push({ account: '2100', [side]: cents(taxTotal) });
  out.push(credit ? { account: '2200', credit: cents(total) } : { account: '1100', debit: cents(total) });
  return out;
}

async function termsFor(invoice, transaction) {
  if (invoice.agreementId) {
    const agreement = await Agreement.findByPk(invoice.agreementId, { attributes: ['termsDays'], transaction });
    if (agreement && agreement.termsDays !== null) return agreement.termsDays;
  }
  return (await customerBilling(invoice.companyId)).termsDays;
}

// { issuedOn? } — defaults to today in the organization's time zone.
async function sendInvoice(invoice, { userId = null, issuedOn = null, transaction = null } = {}) {
  if (issuedOn !== null && issuedOn !== undefined && !isDate(issuedOn)) throw bad('The invoice date is not a date');
  await inTransaction(transaction, async (t) => {
    const row = await Invoice.findByPk(invoice.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!row || row.status !== 'draft') throw state('This invoice has already been sent');
    if (!(await InvoiceLine.count({ where: { invoiceId: row.id }, transaction: t }))) throw bad('An invoice needs at least one line');
    const date = issuedOn || await orgToday();
    row.issuedOn = date;
    await recompute(row, { transaction: t, onDate: date });
    const number = await nextNumber('invoice', t);
    const dueOn = addDays(date, await termsFor(row, t));
    const lines = await InvoiceLine.findAll({ where: { invoiceId: row.id }, transaction: t });
    let ledgerEntryId = null;
    if (!D(row.total).isZero()) {
      const entry = await ledger.postEntry({
        date, memo: `Invoice ${number}`, sourceType: 'invoice', sourceId: row.id, companyId: row.companyId, lines: postingLines(lines, row.taxTotal, row.total),
      }, { transaction: t, userId });
      ledgerEntryId = entry.id;
    }
    // Nothing to pay (everything covered): it's settled as it's sent.
    await row.update({
      number, issuedOn: date, dueOn, ledgerEntryId, status: D(row.total).isZero() ? 'paid' : 'sent', sentAt: new Date(),
    }, { transaction: t });
  });
  return load(invoice.id, { transaction });
}

async function voidInvoice(invoice, { reason, userId = null }) {
  const why = text(reason, 'The reason', 255, true);
  await sequelize.transaction(async (t) => {
    const row = await Invoice.findByPk(invoice.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (row.kind !== 'invoice') throw state('A credit note can\'t be voided; issue an invoice instead');
    if (row.status === 'draft') throw state('A draft is deleted, not voided');
    if (row.status === 'void') throw state('This invoice is already void');
    if (!D(row.amountPaid).isZero() || !D(row.creditApplied).isZero()) {
      throw state('This invoice has payments. Refund them or move them to credit first.', 'HAS_PAYMENTS');
    }
    if (await Invoice.count({ where: { creditForInvoiceId: row.id, status: { [Op.ne]: 'void' } }, transaction: t })) {
      throw state('This invoice has credit notes; it can\'t be voided', 'HAS_CREDIT_NOTES');
    }
    const date = await orgToday();
    if (row.ledgerEntryId) await ledger.reverseEntry(row.ledgerEntryId, { date, memo: `Void ${row.number}`, transaction: t, userId });
    await releaseItems(await lineIdsOf(row.id, t), t);
    await row.update({
      status: 'void', voidReason: why, payTokenHash: null, payTokenExpiresAt: null,
    }, { transaction: t });
  });
  return load(invoice.id);
}

// A credit note against a sent invoice: never more than what's left of it.
async function issueCreditNote(invoice, { lines: rawLines, reason }, { userId = null } = {}) {
  const why = text(reason, 'The reason', 255, true);
  const lines = await readLines(rawLines, { items: false });
  const id = await sequelize.transaction(async (t) => {
    const original = await Invoice.findByPk(invoice.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (original.kind !== 'invoice' || !['sent', 'partly_paid', 'paid'].includes(original.status)) throw state('Only a sent invoice can be credited');
    const date = await orgToday();
    const note = await Invoice.create({
      kind: 'credit_note', companyId: original.companyId, status: 'draft', chargeTax: original.chargeTax, notes: why, creditForInvoiceId: original.id, issuedOn: date, createdBy: userId,
    }, { transaction: t });
    await createLines(note, lines, t);
    await recompute(note, { transaction: t, onDate: date });
    const credited = (await Invoice.findAll({ where: { creditForInvoiceId: original.id, status: { [Op.ne]: 'void' } }, attributes: ['total'], transaction: t }))
      .reduce((s, x) => s.plus(x.total), D(0));
    if (credited.gt(original.total)) throw bad(`A credit can't be more than what's left of the invoice (${cents(D(original.total).minus(credited).plus(note.total))})`);
    const number = await nextNumber('credit_note', t);
    const noteLines = await InvoiceLine.findAll({ where: { invoiceId: note.id }, transaction: t });
    const entry = D(note.total).isZero() ? null : await ledger.postEntry({
      date, memo: `Credit note ${number} for ${original.number}`, sourceType: 'credit_note', sourceId: note.id, companyId: note.companyId,
      lines: postingLines(noteLines, note.taxTotal, note.total, { credit: true }),
    }, { transaction: t, userId });
    await note.update({
      number, status: 'sent', ledgerEntryId: entry ? entry.id : null, sentAt: new Date(),
    }, { transaction: t });
    return note.id;
  });
  return load(id);
}

const balanceOf = (inv) => cents(D(inv.total).minus(inv.amountPaid).minus(inv.creditApplied));

function lineJson(l) {
  return {
    id: l.id,
    kind: l.kind,
    description: l.description,
    quantity: unit(l.quantity),
    unitPrice: unit(l.unitPrice),
    amount: cents(l.amount),
    tax: cents(l.tax),
    taxCategoryId: l.taxCategoryId,
    ticketId: l.ticketId,
    projectId: l.projectId,
    agreementLineId: l.agreementLineId,
    serviceFrom: l.serviceFrom,
    serviceTo: l.serviceTo,
  };
}
function invoiceJson(inv) {
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    companyId: inv.companyId,
    company: inv.company ? { id: inv.company.id, name: inv.company.name } : undefined,
    agreementId: inv.agreementId,
    periodKey: inv.periodKey,
    ticketId: inv.ticketId,
    status: inv.status,
    issuedOn: inv.issuedOn,
    dueOn: inv.dueOn,
    subtotal: cents(inv.subtotal),
    taxTotal: cents(inv.taxTotal),
    total: cents(inv.total),
    amountPaid: cents(inv.amountPaid),
    creditApplied: cents(inv.creditApplied),
    balance: inv.kind === 'invoice' && inv.status !== 'void' ? balanceOf(inv) : '0.00',
    chargeTax: inv.chargeTax,
    billToContactId: inv.billToContactId,
    notes: inv.notes,
    creditForInvoiceId: inv.creditForInvoiceId,
    lateFeeInvoiceId: inv.lateFeeInvoiceId,
    voidReason: inv.voidReason,
    sentAt: inv.sentAt,
    lines: inv.lines ? [...inv.lines].sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id).map(lineJson) : undefined,
    creditNotes: inv.creditNotes ? inv.creditNotes.map((c) => ({
      id: c.id, number: c.number, total: cents(c.total), status: c.status, issuedOn: c.issuedOn,
    })) : undefined,
    createdAt: inv.createdAt,
  };
}

module.exports = {
  KINDS, INCOME, load, readLines, createDraft, claimItems, releaseItems, recompute, updateDraft, deleteDraft,
  sendInvoice, voidInvoice, issueCreditNote, nextNumber, balanceOf, invoiceJson,
};
