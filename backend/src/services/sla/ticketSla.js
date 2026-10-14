// Keeps a ticket's SLA clocks (TicketSlas row) current. Called from the
// Ticket model's afterCreate/afterUpdate hooks — so every path that saves a
// ticket is covered: the ticket screens, workflow actions, inbound email and
// the alert schedulers — and explicitly by the staff comment endpoint for
// first response (a Comment hook can't tell a customer's emailed reply from
// a staff reply: both are type 'reply'). Runs in the caller's transaction;
// errors propagate so a ticket is never saved with stale clocks.
//
// Bulk Ticket.update() calls (contact moves, company merge) fire no
// per-ticket hooks; the ticket keeps the policy it was given.
const { TicketSla, TicketStatus, Company, Ticket } = require('../../models');
const slaCalendar = require('./calendar');
const { businessMinutesBetween } = require('./businessTime');
const {
  emptyClock, startClock, stopClock, retarget,
} = require('./clock');

const CLOCKS = ['assign', 'response', 'resolution'];
const FIELDS = {
  TargetMinutes: 'targetMinutes',
  UsedMinutes: 'usedMinutes',
  RunningSince: 'runningSince',
  DueAt: 'dueAt',
  WarnAt: 'warnAt',
  WarnedAt: 'warnedAt',
  BreachedAt: 'breachedAt',
  MetAt: 'metAt',
};
const WATCHED = ['status', 'assigneeId', 'priority', 'type', 'companyId'];

function readClock(row, c) {
  const s = {};
  Object.entries(FIELDS).forEach(([suffix, key]) => { s[key] = row[`${c}${suffix}`] ?? null; });
  s.usedMinutes = s.usedMinutes || 0;
  return s;
}

function writeClock(values, c, s) {
  Object.entries(FIELDS).forEach(([suffix, key]) => { values[`${c}${suffix}`] = s[key]; }); // eslint-disable-line no-param-reassign
}

const priorityOf = (ticket) => ticket.priority || 'medium';
const typeOf = (ticket) => ticket.type || 'incident';

function targetRow(policy, type, priority) {
  return policy ? policy.targets.get(`${type}:${priority}`) : null;
}

function targetFor(policy, type, priority, c) {
  const t = targetRow(policy, type, priority);
  return t ? (t[`${c}Minutes`] ?? null) : null;
}

// A target with useBusinessHours off counts every minute.
function calendarFor(policy, type, priority) {
  const t = targetRow(policy, type, priority);
  return t && t.useBusinessHours === false ? null : (policy ? policy.calendar : null);
}

// SLA clocks never pause (spec 2026-10-13 change): only open vs not.
async function statusInfo(name, transaction) {
  const s = name ? await TicketStatus.findOne({ where: { name }, attributes: ['behaviorType'], transaction }) : null;
  return { open: !s || s.behaviorType === 'open' };
}

function shouldRun(c, ticket, status, state) {
  if (!status.open) return false;
  if (c === 'assign') return !ticket.assigneeId;
  if (c === 'response') return !state.metAt;
  return true;
}

// The company's policy, else the default.
async function selectPolicyId(ticket, transaction) {
  if (ticket.companyId) {
    const company = await Company.findByPk(ticket.companyId, { attributes: ['slaPolicyId'], transaction });
    if (company && company.slaPolicyId) return company.slaPolicyId;
  }
  return slaCalendar.getDefaultPolicyId(transaction);
}

function markMet(c, s, ticket, status, now) {
  if (c === 'assign' && ticket.assigneeId && !s.metAt) return { ...s, metAt: now };
  if (c === 'resolution') return { ...s, metAt: status.open ? null : (s.metAt || now) };
  return s;
}

// A clock can breach while a ticket is being saved (stopped past its due
// time before the scheduler's next pass, or a new target already used up).
// Those breaches are announced here — the scheduler only looks at clocks
// whose breachedAt is still empty. A breached clock counts as warned.
function newlyBreached(row, values) {
  return CLOCKS.filter((c) => !row[`${c}BreachedAt`] && values[`${c}BreachedAt`]);
}

async function announceBreaches(ticketId, clocks, transaction) {
  if (!clocks.length) return;
  const run = async () => {
    const { announce } = require('./slaScheduler'); // eslint-disable-line global-require
    // eslint-disable-next-line no-restricted-syntax
    for (const c of clocks) {
      try {
        await announce(ticketId, c, 'breach'); // eslint-disable-line no-await-in-loop
      } catch (err) {
        console.error(`[sla] breach announcement for ticket ${ticketId} failed:`, err.message);
      }
    }
  };
  if (transaction) transaction.afterCommit(run);
  else await run();
}

function markWarned(values) {
  CLOCKS.forEach((c) => {
    if (values[`${c}BreachedAt`] && !values[`${c}WarnedAt`]) values[`${c}WarnedAt`] = values[`${c}BreachedAt`]; // eslint-disable-line no-param-reassign
  });
}

async function onTicketCreated(ticket, options = {}) {
  const { transaction } = options;
  const policy = await slaCalendar.getPolicy(await selectPolicyId(ticket, transaction), transaction);
  if (!policy) return;
  const priority = priorityOf(ticket);
  const type = typeOf(ticket);
  const status = await statusInfo(ticket.status, transaction);
  const now = new Date();
  const cal = calendarFor(policy, type, priority);
  const values = {
    ticketId: ticket.id, slaPolicyId: policy.id, ticketType: type, priority,
  };
  CLOCKS.forEach((c) => {
    let s = emptyClock(targetFor(policy, type, priority, c));
    if (shouldRun(c, ticket, status, s)) s = startClock(s, now, cal, policy.warnAtPercent);
    writeClock(values, c, markMet(c, s, ticket, status, now));
  });
  await TicketSla.create(values, { transaction, hooks: false });
}

// Brings every clock in line with the ticket's current state. `retargetAll`
// re-reads targets (priority or policy change) keeping minutes used.
async function apply(row, ticket, policyId, transaction, { retargetAll = false } = {}) {
  const oldPolicy = await slaCalendar.getPolicy(row.slaPolicyId, transaction);
  const policy = (await slaCalendar.getPolicy(policyId, transaction)) || oldPolicy;
  if (!policy) return;
  const priority = priorityOf(ticket);
  const status = await statusInfo(ticket.status, transaction);
  const now = new Date();
  const type = typeOf(ticket);
  const retargeting = retargetAll || policy.id !== row.slaPolicyId || priority !== row.priority || type !== row.ticketType;
  const cal = calendarFor(policy, type, priority);
  const values = { slaPolicyId: policy.id, ticketType: type, priority };

  CLOCKS.forEach((c) => {
    let s = readClock(row, c);
    const run = shouldRun(c, ticket, status, s);
    if (retargeting) {
      // Bank the running spell on the calendar it ran under.
      s = stopClock(s, now, calendarFor(oldPolicy, row.ticketType, row.priority), oldPolicy ? oldPolicy.warnAtPercent : policy.warnAtPercent);
      s = retarget(s, targetFor(policy, type, priority, c), now, cal, policy.warnAtPercent, run);
    } else if (s.runningSince && !run) {
      s = stopClock(s, now, cal, policy.warnAtPercent);
    } else if (!s.runningSince && run) {
      s = startClock(s, now, cal, policy.warnAtPercent);
    }
    writeClock(values, c, markMet(c, s, ticket, status, now));
  });
  markWarned(values);
  const breached = newlyBreached(row, values);
  await row.update(values, { transaction, hooks: false });
  await announceBreaches(ticket.id, breached, transaction);
}

async function onTicketUpdated(ticket, options = {}) {
  if (!WATCHED.some((f) => ticket.changed(f))) return;
  const { transaction } = options;
  const row = await TicketSla.findOne({ where: { ticketId: ticket.id }, transaction });
  if (!row) return; // tickets from before the SLA engine have no clocks
  const policyId = ticket.changed('companyId') ? await selectPolicyId(ticket, transaction) : row.slaPolicyId;
  await apply(row, ticket, policyId, transaction);
}

async function recordFirstResponse(ticketId, { transaction } = {}) {
  const row = await TicketSla.findOne({ where: { ticketId }, transaction });
  if (!row || row.responseMetAt) return;
  const policy = await slaCalendar.getPolicy(row.slaPolicyId, transaction);
  const now = new Date();
  const s = stopClock(readClock(row, 'response'), now, calendarFor(policy, row.ticketType, row.priority), policy ? policy.warnAtPercent : 75);
  const values = {};
  writeClock(values, 'response', { ...s, metAt: now });
  markWarned(values);
  const breached = newlyBreached(row, values);
  await row.update(values, { transaction, hooks: false });
  await announceBreaches(ticketId, breached, transaction);
}

// Re-times a ticket against `policyId` (or its company's / the default).
async function recalcTicketSla(ticketId, { policyId, transaction } = {}) {
  const ticket = await Ticket.findByPk(ticketId, { transaction });
  const row = ticket && await TicketSla.findOne({ where: { ticketId }, transaction });
  if (!row) return;
  await apply(row, ticket, policyId || await selectPolicyId(ticket, transaction), transaction, { retargetAll: true });
}

// Brings a ticket's clocks in line with its current state, keeping its
// policy and targets — for changes that bypass the model hooks (a status
// deleted or reconfigured under tickets that are in it).
async function syncTicketSla(ticketId, { transaction } = {}) {
  const ticket = await Ticket.findByPk(ticketId, { transaction });
  const row = ticket && await TicketSla.findOne({ where: { ticketId }, transaction });
  if (!row) return;
  await apply(row, ticket, row.slaPolicyId, transaction);
}

// Business minutes a clock has used up to `now`, including a running spell.
async function liveUsedMinutes(row, c, now = new Date()) {
  const used = row[`${c}UsedMinutes`] || 0;
  if (!row[`${c}RunningSince`]) return used;
  const policy = await slaCalendar.getPolicy(row.slaPolicyId);
  return used + businessMinutesBetween(row[`${c}RunningSince`], now, calendarFor(policy, row.ticketType, row.priority));
}

module.exports = {
  onTicketCreated, onTicketUpdated, recordFirstResponse, recalcTicketSla, syncTicketSla, liveUsedMinutes,
};
