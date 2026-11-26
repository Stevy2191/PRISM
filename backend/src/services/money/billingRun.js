// The billing run (Phase 3, step 3). On the 1st (org time zone), each
// customer gets one draft invoice for the month:
//   - the coming month's agreement fees at this month's counts; the first
//     month prorated by days; people, devices or licenses added since last
//     month caught up at a full month (setting); a cancelled agreement bills
//     no fees after its last day;
//   - last month's extras on its tickets, entries dated before the month:
//     time after the billing rules (chargesFor), covered time at $0,
//     prepaid hours drawn down and overage past the block, materials at
//     their price, rebilled expenses at cost.
// One run invoice per company per month (Invoices.periodKey, unique), built
// under a lock on the company row, so running twice changes nothing.
// Customers billed per job (invoiceTiming 'on_close') get their ticket work
// invoiced when the ticket closes (draftForTicket) instead.
// Project work waits for step 5 (project billing).
const { Op } = require('sequelize');
const {
  Company, Agreement, AgreementLine, Invoice, Ticket, TimeEntry, WorkType, ProjectMaterial, Expense, TaxCategory,
  SystemSettings, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const {
  orgTimeZone, todayInZone, zoneDayStart, addDays, orgToday,
} = require('../../utils/orgTime');
const { D, unit } = require('./money');
const { moneyConfig } = require('./config');
const { customerBilling } = require('./tax');
const { chargesFor } = require('./billingRules');
const { isAfterHours } = require('./afterHours');
const { quantityFor } = require('./agreements');
const invoices = require('./invoices');
const { emailInvoice } = require('./invoiceMail');

const monthStart = (date) => `${date.slice(0, 7)}-01`;
function monthEnd(date) {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const FEE_KIND = {
  flat: 'agreement', per_user: 'agreement', per_device: 'agreement', license: 'license', prepaid_hours: 'prepaid_hours',
};
const COUNTED = new Set(['per_user', 'per_device', 'license']);
const fmt = (q) => D(q).toDecimalPlaces(4).toString();

// The agreement in force on a day, from the company's agreements.
const agreementOn = (agreements, day) => agreements
  .filter((a) => a.startsOn <= day && (!a.endsOn || a.endsOn >= day))
  .sort((x, y) => (x.startsOn < y.startsOn ? 1 : -1))[0] || null;
const covers = (agreement) => !!agreement && agreement.lines.some((l) => l.kind !== 'prepaid_hours');
const blockOf = (agreement) => (agreement ? agreement.lines.find((l) => l.kind === 'prepaid_hours') || null : null);

async function categoryIds() {
  const rows = await TaxCategory.findAll({ where: { active: true }, attributes: ['id', 'name'] });
  const byName = new Map(rows.map((c) => [c.name, c.id]));
  return { onSite: byName.get('On-site labor'), remote: byName.get('Remote support') };
}

// The last day an agreement's fees have been billed through: the latest
// service end of its fee lines on invoices that aren't void (a deleted
// draft or a voided invoice un-bills its days). Null: never billed.
async function billedThrough(agreement, transaction) {
  const [row] = await sequelize.query(
    `SELECT MAX(l.serviceTo) AS last FROM InvoiceLines l JOIN Invoices i ON i.id = l.invoiceId
      WHERE (i.agreementId = :id OR l.agreementLineId IN (:lineIds)) AND i.status <> 'void'
        AND l.kind IN ('agreement', 'license', 'prepaid_hours') AND l.serviceTo IS NOT NULL`,
    { replacements: { id: agreement.id, lineIds: agreement.lines.length ? agreement.lines.map((l) => l.id) : [-1] }, type: sequelize.QueryTypes.SELECT, transaction },
  );
  return row && row.last ? String(row.last).slice(0, 10) : null;
}

// Fees from the day after the agreement was last billed through, to the
// end of the coming month: a month the agreement started in after its 1st
// (and any month missed) is billed on the next run, each month prorated by
// its days. Updates each counted line's lastBilledQuantity.
async function feeLines(agreement, { periodStart, periodEnd, transaction, catchUp }) {
  const through = await billedThrough(agreement, transaction);
  let from = through ? addDays(through, 1) : agreement.startsOn;
  if (from < agreement.startsOn) from = agreement.startsOn;
  const to = agreement.endsOn && agreement.endsOn < periodEnd ? agreement.endsOn : periodEnd;
  if (from > to) return [];
  const segments = [];
  for (let m = monthStart(from); m <= to; m = addDays(monthEnd(m), 1)) {
    const segStart = from > m ? from : m;
    const segEnd = monthEnd(m) < to ? monthEnd(m) : to;
    segments.push({
      start: segStart, end: segEnd, days: daysBetween(segStart, segEnd), inMonth: daysBetween(m, monthEnd(m)),
    });
  }
  const prevStart = monthStart(addDays(periodStart, -1));
  const lines = [];
  const catchUps = [];
  const ctx = {};
  const ordered = [...agreement.lines].sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id);
  const counts = new Map();
  for (const line of ordered) {
    counts.set(line.id, (await quantityFor(line, agreement, ctx)).quantity); // eslint-disable-line no-await-in-loop
  }
  for (const seg of segments) {
    const whole = seg.days === seg.inMonth;
    for (const line of ordered) {
      const quantity = counts.get(line.id);
      const prorated = whole ? quantity : unit(D(quantity).times(seg.days).div(seg.inMonth));
      const count = COUNTED.has(line.kind) ? ` × ${fmt(quantity)}` : '';
      const part = whole ? '' : ` (${seg.days} of ${seg.inMonth} days)`;
      if (!D(prorated).isZero()) {
        lines.push({
          kind: FEE_KIND[line.kind], description: `${line.description}${count}${part}`, quantity: prorated, unitPrice: line.unitPrice, taxCategoryId: line.taxCategoryId, agreementLineId: line.id, serviceFrom: seg.start, serviceTo: seg.end,
        });
      }
    }
  }
  const billsThisMonth = segments.some((seg) => seg.start === periodStart);
  for (const line of ordered) {
    if (!COUNTED.has(line.kind)) continue; // eslint-disable-line no-continue
    const quantity = counts.get(line.id);
    const last = line.lastBilledQuantity;
    if (catchUp && billsThisMonth && last !== null && last !== undefined && D(quantity).gt(last)) {
      const more = unit(D(quantity).minus(last));
      catchUps.push({
        kind: FEE_KIND[line.kind], description: `${line.description} — ${fmt(more)} added during ${prevStart.slice(0, 7)}`, quantity: more, unitPrice: line.unitPrice, taxCategoryId: line.taxCategoryId, agreementLineId: line.id, serviceFrom: prevStart, serviceTo: monthEnd(prevStart),
      });
    }
    await AgreementLine.update({ lastBilledQuantity: quantity }, { where: { id: line.id }, transaction }); // eslint-disable-line no-await-in-loop
  }
  return [...lines, ...catchUps];
}

// A charge line (from chargesFor) as an invoice line.
function timeLine(charge, { tickets, entries, cats }) {
  const ticketNo = (tickets.get(charge.ticketId) || {}).number || `#${charge.ticketId}`;
  const onSite = charge.entryIds.some((id) => entries.get(id).onSite);
  const where = `${ticketNo}, ${charge.date}`;
  const taxCategoryId = onSite ? cats.onSite : cats.remote;
  if (charge.kind === 'trip') {
    return {
      kind: 'trip', description: `Trip charge — ${where}`, quantity: '1', unitPrice: charge.rate, taxCategoryId: cats.onSite, ticketId: charge.ticketId, callDate: charge.date,
    };
  }
  const label = `${onSite ? 'On-site labor' : 'Remote support'}${charge.kind === 'after_hours' ? ', after hours' : ''}`;
  return {
    kind: charge.kind,
    description: `${label} — ${where} (${charge.minutes} min worked, ${charge.billedMinutes} billed)`,
    quantity: unit(D(charge.billedMinutes).div(60)),
    unitPrice: charge.rate,
    taxCategoryId,
    ticketId: charge.ticketId,
    timeEntryIds: charge.entryIds,
    billedMinutes: charge.billedMinutes,
    callDate: charge.date,
  };
}
const coveredLine = (group, { tickets }, why = 'Covered by your agreement') => ({
  kind: 'covered',
  description: `${why} — ${(tickets.get(group.ticketId) || {}).number || `#${group.ticketId}`}, ${group.date} (${group.minutes} min)`,
  quantity: unit(D(group.minutes).div(60)),
  unitPrice: '0',
  ticketId: group.ticketId,
  timeEntryIds: group.entryIds,
});

// Minutes a prepaid block has left for a month of work: its hours for that
// month (with rollover, for every month since the agreement started, worked
// or not) less what invoices that aren't void have drawn for it.
async function blockMinutesLeft(block, agreement, month, transaction) {
  const first = agreement.startsOn.slice(0, 7);
  if (month < first) return 0;
  const [fy, fm] = first.split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  const months = block.rollover ? (y - fy) * 12 + (m - fm) + 1 : 1;
  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(l.prepaidMinutes), 0) AS drawn FROM InvoiceLines l JOIN Invoices i ON i.id = l.invoiceId
      WHERE i.status <> 'void' AND l.agreementLineId = :id AND l.blockMonth ${block.rollover ? '<=' : '='} :month`,
    { replacements: { id: block.id, month }, type: sequelize.QueryTypes.SELECT, transaction },
  );
  return Math.round(D(block.hours).times(60).times(months).toNumber()) - Number(row.drawn);
}

// Draws billed labor from a prepaid block, by the month the work was done;
// what doesn't fit is overage. Each line records what it drew, so the
// balance is always worked out from invoices.
async function drawFromBlock(lines, block, agreement, { rates, transaction, tickets }) {
  const overageRate = block.overageRate !== null && block.overageRate !== undefined ? block.overageRate : rates.hourlyRate;
  const drawnNow = new Map(); // month → minutes drawn by these lines
  const out = [];
  for (const line of lines) {
    if (line.kind !== 'labor') {
      out.push(line);
      continue; // eslint-disable-line no-continue
    }
    const month = line.callDate.slice(0, 7);
    let pending = 0;
    drawnNow.forEach((mins, mo) => { if (block.rollover ? mo <= month : mo === month) pending += mins; });
    const left = Math.max(0, (await blockMinutesLeft(block, agreement, month, transaction)) - pending); // eslint-disable-line no-await-in-loop
    const fromBlock = Math.min(left, line.billedMinutes);
    drawnNow.set(month, (drawnNow.get(month) || 0) + fromBlock);
    const over = line.billedMinutes - fromBlock;
    const draw = { agreementLineId: block.id, prepaidMinutes: fromBlock, blockMonth: month };
    if (!over) {
      out.push({
        ...coveredLine({
          ticketId: line.ticketId, date: line.callDate, minutes: line.billedMinutes, entryIds: line.timeEntryIds,
        }, { tickets }, 'Prepaid hours'),
        ...draw,
      });
    } else {
      out.push({
        ...line,
        ...draw,
        kind: 'overage',
        description: `${line.description.replace(/ \(.*\)$/, '')} — ${over} min past the prepaid hours${fromBlock ? ` (${fromBlock} min from the block)` : ''}`,
        quantity: unit(D(over).div(60)),
        unitPrice: overageRate,
      });
    }
  }
  return out;
}

// Unbilled billable work on the company's tickets (or one ticket), as
// invoice lines. `before`: only work dated before that day.
async function extraLines(company, { agreements, before = null, ticketId = null, transaction }) {
  const [billing, cfg, cats] = await Promise.all([customerBilling(company.id), moneyConfig(), categoryIds()]);
  const rates = { hourlyRate: billing.hourlyRate, afterHoursRate: billing.afterHoursRate, tripCharge: billing.tripCharge };
  const ticketWhere = ticketId ? { id: ticketId } : { companyId: company.id };
  const tickets = new Map((await Ticket.findAll({ where: ticketWhere, attributes: ['id', 'number'], transaction })).map((t) => [t.id, t]));
  if (!tickets.size) return [];
  const ticketIds = [...tickets.keys()];
  const tz = await orgTimeZone({ transaction });

  const rows = await TimeEntry.findAll({
    where: {
      ticketId: ticketIds, billingStatus: 'unbilled', billable: true, durationSeconds: { [Op.gt]: 0 }, ...(before ? { entryDate: { [Op.lt]: before } } : {}),
    },
    include: [{ model: WorkType, as: 'workType', attributes: ['id', 'onSite'] }],
    order: [['entryDate', 'ASC'], ['id', 'ASC']],
    transaction,
  });
  const entries = new Map();
  const sets = new Map(); // key → { recurring, block, entries }
  for (const row of rows) {
    const entry = {
      id: row.id,
      ticketId: row.ticketId,
      entryDate: row.entryDate,
      durationSeconds: row.durationSeconds,
      onSite: !!(row.workType && row.workType.onSite),
      afterHours: await isAfterHours(row, company.id), // eslint-disable-line no-await-in-loop
      billable: true,
    };
    entries.set(entry.id, entry);
    const agreement = agreementOn(agreements, row.entryDate);
    const recurring = covers(agreement);
    const block = recurring ? null : blockOf(agreement);
    const key = recurring ? 'recurring' : (block ? `block:${block.id}` : 'event');
    if (!sets.has(key)) sets.set(key, { recurring, block, agreement, entries: [] });
    sets.get(key).entries.push(entry);
  }

  const lines = [];
  const ctx = { tickets, entries, cats };
  for (const set of sets.values()) {
    const { lines: charges, covered } = chargesFor(set.entries, {
      recurring: set.recurring, rates, minimumMinutes: cfg.eventMinimumMinutes, stepMinutes: cfg.stepMinutes,
    });
    let out = charges.map((c) => timeLine(c, ctx));
    if (set.block) out = await drawFromBlock(out, set.block, set.agreement, { rates, transaction, tickets }); // eslint-disable-line no-await-in-loop
    // Each call's trip charge, then its covered time, in date order.
    const coveredByCall = new Map(covered.map((g) => [`${g.ticketId}|${g.date}`, g]));
    for (const line of out) {
      lines.push(line);
      const key = line.kind === 'trip' ? `${line.ticketId}|${line.callDate}` : null;
      if (key && coveredByCall.has(key)) {
        lines.push(coveredLine(coveredByCall.get(key), ctx));
        coveredByCall.delete(key);
      }
    }
    for (const g of coveredByCall.values()) lines.push(coveredLine(g, ctx));
  }

  const cutoff = before ? zoneDayStart(before, tz) : null;
  const materials = await ProjectMaterial.findAll({
    where: {
      ticketId: ticketIds, billingStatus: 'unbilled', billable: true, ...(cutoff ? { createdAt: { [Op.lt]: cutoff } } : {}),
    },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    transaction,
  });
  materials.forEach((m) => {
    if (D(m.quantity).lte(0)) return;
    lines.push({
      kind: 'material', description: `${m.itemName} — ${(tickets.get(m.ticketId) || {}).number || ''}`.replace(/ — $/, ''), quantity: unit(m.quantity), unitPrice: unit(m.unitPrice || 0), taxCategoryId: m.taxCategoryId || undefined, ticketId: m.ticketId, materialIds: [m.id],
    });
  });
  const expenses = await Expense.findAll({
    where: {
      ticketId: ticketIds, billingStatus: 'unbilled', rebillable: true, voided: false, ...(before ? { spentOn: { [Op.lt]: before } } : {}),
    },
    order: [['spentOn', 'ASC'], ['id', 'ASC']],
    transaction,
  });
  expenses.forEach((x) => lines.push({
    kind: 'expense', description: `${x.description} (${x.spentOn})`, quantity: '1', unitPrice: unit(x.amount), ticketId: x.ticketId, expenseIds: [x.id],
  }));
  return lines.map(({ billedMinutes, callDate, ...l }) => l); // eslint-disable-line no-unused-vars
}

async function companyAgreements(companyId, transaction) {
  return Agreement.findAll({ where: { companyId }, include: [{ model: AgreementLine, as: 'lines' }], transaction });
}

// → { status: 'drafted'|'exists'|'nothing', invoice }
async function buildForCompany(companyId, { runDate, userId = null, transaction }) {
  const company = await Company.findByPk(companyId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!company) throw new ApiError(404, 'Company not found', 'NOT_FOUND');
  const periodKey = runDate.slice(0, 7);
  const existing = await Invoice.findOne({ where: { companyId, periodKey }, transaction });
  if (existing) return { status: 'exists', invoice: await invoices.load(existing.id, { transaction }) };
  const periodStart = monthStart(runDate);
  const periodEnd = monthEnd(runDate);
  const [agreements, cfg, billing] = await Promise.all([companyAgreements(companyId, transaction), moneyConfig(), customerBilling(companyId)]);
  const feeAgreement = agreements
    .filter((a) => a.startsOn <= periodEnd && (!a.endsOn || a.endsOn >= periodStart))
    .sort((x, y) => (x.startsOn < y.startsOn ? 1 : -1))[0] || null;
  // Every agreement's days not yet billed, up to the month's end (a
  // cancelled one's last days included), oldest agreement first.
  const lines = [];
  const byStart = [...agreements].filter((a) => a.startsOn <= periodEnd).sort((x, y) => (x.startsOn < y.startsOn ? -1 : 1));
  for (const agreement of byStart) {
    // eslint-disable-next-line no-await-in-loop
    lines.push(...await feeLines(agreement, {
      periodStart, periodEnd, transaction, catchUp: cfg.catchUpAdditions && agreement === feeAgreement,
    }));
  }
  if (billing.invoiceTiming !== 'on_close') lines.push(...await extraLines(company, { agreements, before: periodStart, transaction }));
  if (!lines.length) return { status: 'nothing', invoice: null };
  const invoice = await invoices.createDraft(company, { lines, agreementId: feeAgreement ? feeAgreement.id : null, periodKey }, { userId, transaction, internal: true });
  return { status: 'drafted', invoice };
}

function checkRunDate(runDate) {
  if (!isDate(runDate)) throw new ApiError(400, 'The run date is not a date', 'VALIDATION_ERROR');
  return runDate;
}

// One company's draft for the month of runDate, or the one it already has,
// or null when there's nothing to bill.
async function draftForCompany(companyId, { runDate, userId = null }) {
  checkRunDate(runDate);
  return (await sequelize.transaction((transaction) => buildForCompany(companyId, { runDate, userId, transaction }))).invoice;
}

// The companies that might have something to bill this month.
async function candidates(periodStart, periodEnd) {
  const rows = await sequelize.query(
    `SELECT c.id FROM Companies c
      WHERE c.isInternal = 0 AND (
        EXISTS (SELECT 1 FROM Agreements a WHERE a.companyId = c.id AND a.startsOn <= :periodEnd AND (a.endsOn IS NULL OR a.endsOn >= :periodStart))
        OR EXISTS (SELECT 1 FROM TimeEntries t JOIN Tickets k ON k.id = t.ticketId
                    WHERE k.companyId = c.id AND t.billingStatus = 'unbilled' AND t.billable = 1 AND t.entryDate < :periodStart)
        OR EXISTS (SELECT 1 FROM ProjectMaterials m JOIN Tickets k ON k.id = m.ticketId
                    WHERE k.companyId = c.id AND m.billingStatus = 'unbilled' AND m.billable = 1)
        OR EXISTS (SELECT 1 FROM Expenses x JOIN Tickets k ON k.id = x.ticketId
                    WHERE k.companyId = c.id AND x.billingStatus = 'unbilled' AND x.rebillable = 1 AND x.voided = 0 AND x.spentOn < :periodStart))
      ORDER BY c.name`,
    { replacements: { periodStart, periodEnd }, type: sequelize.QueryTypes.SELECT },
  );
  return rows.map((r) => r.id);
}

const ROLLBACK = Symbol('preview');

// { runDate, userId, preview } → { drafted: [...], skipped: [...] }; with
// preview, every draft is built and rolled back (nothing written) and
// drafted carries each draft's lines.
async function billingRun({ runDate = null, userId = null, preview = false } = {}) {
  const date = checkRunDate(runDate || await orgToday());
  const ids = await candidates(monthStart(date), monthEnd(date));
  const drafted = [];
  const skipped = [];
  for (const companyId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.transaction(async (transaction) => {
        const { status, invoice } = await buildForCompany(companyId, { runDate: date, userId, transaction });
        if (status === 'drafted') {
          const json = invoices.invoiceJson(invoice);
          drafted.push({
            companyId, invoiceId: preview ? null : invoice.id, total: json.total, ...(preview ? { lines: json.lines, subtotal: json.subtotal, taxTotal: json.taxTotal } : {}),
          });
        } else {
          skipped.push({ companyId, reason: status === 'exists' ? 'already drafted' : 'nothing to bill', invoiceId: invoice ? invoice.id : null });
        }
        if (preview) throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) skipped.push({ companyId, reason: err.message || 'failed' });
    }
  }
  const names = new Map((await Company.findAll({ where: { id: ids }, attributes: ['id', 'name'] })).map((c) => [c.id, c.name]));
  const named = (x) => ({ ...x, companyName: names.get(x.companyId) || null });
  return { runDate: date, drafted: drafted.map(named), skipped: skipped.map(named) };
}

// A per-job customer's closed ticket: its unbilled work on its own invoice.
async function draftForTicket(ticket, { userId = null } = {}) {
  if (!(await moneyConfig()).customerBilling) return null;
  const billing = await customerBilling(ticket.companyId);
  if (billing.invoiceTiming !== 'on_close') return null;
  return sequelize.transaction(async (transaction) => {
    const company = await Company.findByPk(ticket.companyId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!company || company.isInternal) return null;
    const agreements = await companyAgreements(company.id, transaction);
    const lines = await extraLines(company, { agreements, ticketId: ticket.id, transaction });
    if (!lines.length) return null;
    return invoices.createDraft(company, { lines, ticketId: ticket.id }, { userId, transaction, internal: true });
  });
}

// The scheduler's check: on the 1st (org time zone), once a month.
async function maybeRunBilling({ now = new Date() } = {}) {
  const cfg = await moneyConfig();
  if (!cfg.customerBilling) return { ran: false };
  const today = todayInZone(await orgTimeZone(), now);
  if (today.slice(8) !== '01') return { ran: false };
  const period = today.slice(0, 7);
  const claimed = await sequelize.transaction(async (transaction) => {
    await SystemSettings.findOrCreate({ where: { key: 'money.lastBillingRun' }, defaults: { value: '' }, transaction });
    const row = await SystemSettings.findByPk('money.lastBillingRun', { transaction, lock: transaction.LOCK.UPDATE });
    if (row.value === period) return false;
    await row.update({ value: period }, { transaction });
    return true;
  });
  if (!claimed) return { ran: false };
  const result = await billingRun({ runDate: today });
  if (cfg.autoSend) {
    for (const d of result.drafted) {
      // eslint-disable-next-line no-await-in-loop
      try {
        const sent = await invoices.sendInvoice({ id: d.invoiceId }, { issuedOn: today });
        if (sent.status !== 'paid') await emailInvoice(sent);
      } catch (err) {
        console.error('[billing] auto-send failed', d.invoiceId, err.message);
      }
    }
  }
  return { ran: true, result };
}

let started = false;
function startBillingScheduler() {
  if (started) return;
  started = true;
  const tick = () => maybeRunBilling().catch((err) => console.error('[billing] run failed:', err));
  tick();
  setInterval(tick, 60 * 60 * 1000);
  console.log('[billing] scheduler started (checking hourly for the 1st)');
}

module.exports = {
  draftForCompany, billingRun, draftForTicket, maybeRunBilling, startBillingScheduler,
};
