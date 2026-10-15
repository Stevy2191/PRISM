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
const {
  TicketSla, TicketStatus, Company, Ticket, TicketDueDateChange,
} = require('../../models');
const slaCalendar = require('./calendar');
const { ApiError } = require('../../middleware/error');
const { businessMinutesBetween, addBusinessMinutes, addBusinessDays } = require('./businessTime');
const { orgTimeZone, dateInZone, timeInZone } = require('../../utils/orgTime');
const {
  emptyClock, startClock, stopClock, retarget, warnMinutes, fixedClock, stopFixed, startFixed,
} = require('./clock');

const CLOCKS = ['assign', 'response', 'resolution'];
const MAX_AHEAD_MS = 2 * 366 * 24 * 60 * 60 * 1000;
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
// The SLA is fixed when the ticket is created (spec 2026-10-13 change):
// only status (open or not) and assignee move clocks afterwards. Priority,
// type and company changes leave every SLA date alone.
const WATCHED = ['status', 'assigneeId'];

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

// → { amount, unit } or null (not tracked).
function targetFor(policy, type, priority, c) {
  const t = targetRow(policy, type, priority);
  const amount = t ? t[`${c}Minutes`] : null;
  return amount ? { amount, unit: t[`${c}Unit`] || 'minutes' } : null;
}

function dueFrom(start, target, calendar) {
  return target.unit === 'business_days'
    ? addBusinessDays(start, target.amount, calendar)
    : addBusinessMinutes(start, target.amount, calendar);
}

// A clock fresh from its target, started at `start` if it should run.
function clockFromTarget(c, start, target, calendar, warnPct, run) {
  if (!target) return emptyClock(null);
  if (c === 'resolution') {
    const s = fixedClock(start, dueFrom(start, target, calendar), calendar, warnPct);
    return run ? s : stopFixed(s, start, calendar);
  }
  const minutes = target.unit === 'business_days'
    ? businessMinutesBetween(start, dueFrom(start, target, calendar), calendar)
    : target.amount;
  const s = emptyClock(minutes);
  return run ? startClock(s, start, calendar, warnPct) : s;
}

// Ticket.dueDate / dueTime follow the resolution due instant, on the
// organization's calendar, so lists, the calendar and overdue filters agree.
async function mirrorDueDate(ticketId, dueAt, transaction) {
  if (!dueAt) return;
  const tz = await orgTimeZone({ transaction });
  await Ticket.update(
    { dueDate: dateInZone(new Date(dueAt), tz), dueTime: timeInZone(dueAt, tz) },
    { where: { id: ticketId }, hooks: false, transaction }
  );
}

// A target with useBusinessHours off counts every minute.
function calendarFor(policy, type, priority) {
  const t = targetRow(policy, type, priority);
  return t && t.useBusinessHours === false ? null : (policy ? policy.calendar : null);
}

// SLA clocks never pause (spec 2026-10-13 change): only open vs not.
async function statusInfo(name, transaction) {
  const s = name ? await TicketStatus.findOne({ where: { name }, attributes: ['behaviorType'], transaction }) : null;
  // On hold never stops the clock (user decision 2026-10-15).
  return { open: !s || s.behaviorType === 'open' || s.behaviorType === 'on_hold' };
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
    const s = clockFromTarget(c, now, targetFor(policy, type, priority, c), cal, policy.warnAtPercent, shouldRun(c, ticket, status, { metAt: null }));
    writeClock(values, c, markMet(c, s, ticket, status, now));
  });
  values.resolutionOriginalDueAt = values.resolutionDueAt;
  await TicketSla.create(values, { transaction, hooks: false });
  await mirrorDueDate(ticket.id, values.resolutionDueAt, transaction);
}

// Starts and stops clocks to match the ticket's status and assignee.
async function apply(row, ticket, transaction) {
  const policy = await slaCalendar.getPolicy(row.slaPolicyId, transaction);
  if (!policy) return;
  const status = await statusInfo(ticket.status, transaction);
  const now = new Date();
  const cal = calendarFor(policy, row.ticketType, row.priority);
  const pct = policy.warnAtPercent;
  const values = {};
  let newDue = null;
  CLOCKS.forEach((c) => {
    let s = readClock(row, c);
    const run = shouldRun(c, ticket, status, s);
    if (c === 'resolution') {
      if (s.runningSince && !run) s = stopFixed(s, now, cal);
      else if (!s.runningSince && run) {
        if (!s.dueAt && s.targetMinutes !== null) {
          // A clock from the first SLA build, stopped with no due date:
          // its remaining minutes become a fixed due date from now.
          const left = Math.max(0, s.targetMinutes - s.usedMinutes);
          s = {
            ...s,
            dueAt: addBusinessMinutes(now, left, cal),
            warnAt: addBusinessMinutes(now, Math.max(0, warnMinutes(s.targetMinutes, pct) - s.usedMinutes), cal),
          };
          if (!row.resolutionOriginalDueAt) values.resolutionOriginalDueAt = s.dueAt;
          newDue = s.dueAt;
        }
        s = startFixed(s, now);
      }
    } else if (s.runningSince && !run) {
      s = stopClock(s, now, cal, pct);
    } else if (!s.runningSince && run) {
      s = startClock(s, now, cal, pct);
    }
    writeClock(values, c, markMet(c, s, ticket, status, now));
  });
  markWarned(values);
  const breached = newlyBreached(row, values);
  await row.update(values, { transaction, hooks: false });
  if (newDue) await mirrorDueDate(ticket.id, newDue, transaction);
  await announceBreaches(ticket.id, breached, transaction);
}

async function onTicketUpdated(ticket, options = {}) {
  if (!WATCHED.some((f) => ticket.changed(f))) return;
  const { transaction } = options;
  const row = await TicketSla.findOne({ where: { ticketId: ticket.id }, transaction });
  if (!row) return; // tickets from before the SLA engine have no clocks
  await apply(row, ticket, transaction);
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

// Set SLA policy: re-times the ticket from its creation on `policyId` (or
// its company's / the default), for its current type and priority. Minutes
// already used are kept; the resolution due date and the original due date
// are recomputed; the due date history is left as it is.
async function recalcTicketSla(ticketId, { policyId, transaction } = {}) {
  const ticket = await Ticket.findByPk(ticketId, { transaction });
  const row = ticket && await TicketSla.findOne({ where: { ticketId }, transaction });
  if (!row) return;
  const policy = await slaCalendar.getPolicy(policyId || await selectPolicyId(ticket, transaction), transaction);
  if (!policy) return;
  const oldPolicy = await slaCalendar.getPolicy(row.slaPolicyId, transaction);
  const type = typeOf(ticket);
  const priority = priorityOf(ticket);
  const status = await statusInfo(ticket.status, transaction);
  const now = new Date();
  const start = new Date(ticket.createdAt);
  const cal = calendarFor(policy, type, priority);
  const pct = policy.warnAtPercent;
  const values = { slaPolicyId: policy.id, ticketType: type, priority };

  ['assign', 'response'].forEach((c) => {
    const target = targetFor(policy, type, priority, c);
    const minutes = target ? businessMinutesBetween(start, dueFrom(start, target, cal), cal) : null;
    let s = stopClock(readClock(row, c), now, calendarFor(oldPolicy, row.ticketType, row.priority), pct);
    s = retarget(s, minutes, now, cal, pct, shouldRun(c, ticket, status, s));
    writeClock(values, c, s);
  });

  const target = targetFor(policy, type, priority, 'resolution');
  let s = readClock(row, 'resolution');
  if (!target) {
    s = { ...emptyClock(null), usedMinutes: s.usedMinutes };
  } else {
    const due = dueFrom(start, target, cal);
    const span = businessMinutesBetween(start, due, cal);
    s = {
      ...s,
      targetMinutes: span,
      dueAt: due,
      warnAt: addBusinessMinutes(start, warnMinutes(span, pct), cal),
      runningSince: s.runningSince || (status.open ? now : null),
    };
    if (due > now) {
      s.breachedAt = null;
      if (s.warnAt > now) s.warnedAt = null;
    } else if (!s.breachedAt && (s.runningSince || (s.metAt && new Date(s.metAt) > due))) {
      s.breachedAt = due;
    }
  }
  writeClock(values, 'resolution', s);
  values.resolutionOriginalDueAt = values.resolutionDueAt;
  markWarned(values);
  const breached = newlyBreached(row, values);
  await row.update(values, { transaction, hooks: false });
  await mirrorDueDate(ticketId, values.resolutionDueAt, transaction);
  await announceBreaches(ticketId, breached, transaction);
}

// Brings a ticket's clocks in line with its current state, keeping its
// policy and targets — for changes that bypass the model hooks (a status
// deleted or reconfigured under tickets that are in it).
async function syncTicketSla(ticketId, { transaction } = {}) {
  const ticket = await Ticket.findByPk(ticketId, { transaction });
  const row = ticket && await TicketSla.findOne({ where: { ticketId }, transaction });
  if (!row) return;
  await apply(row, ticket, transaction);
}

// Moves the resolution due date (spec 2026-10-13 change). The caller has
// checked who may move it which way; this records the change, re-derives the
// warning point and lets warning and breach fire again for a future date.
// → { fromDueAt, toDueAt } or null when the ticket has no SLA due date.
async function changeDueDate(ticketId, {
  toDueAt, userId = null, reason = null, kind, transaction,
}) {
  const to0 = new Date(toDueAt);
  if (!(to0 <= new Date(Date.now() + MAX_AHEAD_MS))) {
    // Business-time walks are per day: an absurd date would block the server.
    throw new ApiError(400, 'A due date can be at most two years ahead', 'VALIDATION_ERROR');
  }
  const ticket = await Ticket.findByPk(ticketId, { attributes: ['id', 'createdAt'], transaction });
  // Locked, so two changes at once can't turn an extension into a move
  // earlier than the date the other one set.
  const row = ticket && await TicketSla.findOne({
    where: { ticketId }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!row || !row.resolutionDueAt) return null;
  if (kind === 'extension' && !(to0 > new Date(row.resolutionDueAt))) {
    throw new ApiError(409, 'The due date has changed; an extension must be later than the current due date', 'NOT_LATER');
  }
  const policy = await slaCalendar.getPolicy(row.slaPolicyId, transaction);
  const cal = calendarFor(policy, row.ticketType, row.priority);
  const pct = policy ? policy.warnAtPercent : 75;
  const now = new Date();
  const to = new Date(toDueAt);
  const start = new Date(ticket.createdAt);
  const span = businessMinutesBetween(start, to, cal);
  let s = readClock(row, 'resolution');
  s = {
    ...s,
    targetMinutes: span,
    dueAt: to,
    warnAt: addBusinessMinutes(start, warnMinutes(span, pct), cal),
  };
  // An open ticket's warning and breach can fire again for a future date;
  // a closed ticket's result is history and stays as it was.
  if (s.runningSince && to > now) {
    s.breachedAt = null;
    if (s.warnAt > now) s.warnedAt = null;
  } else if (!s.breachedAt && s.runningSince) {
    s.breachedAt = to;
  }
  const values = {};
  writeClock(values, 'resolution', s);
  markWarned(values);
  const breached = newlyBreached(row, values);
  const fromDueAt = row.resolutionDueAt;
  await row.update(values, { transaction, hooks: false });
  await TicketDueDateChange.create({
    ticketId, userId, fromDueAt, toDueAt: to, reason: reason || null, kind,
  }, { transaction });
  await mirrorDueDate(ticketId, to, transaction);
  await announceBreaches(ticketId, breached, transaction);
  return { fromDueAt, toDueAt: to };
}

// Business minutes a clock has used up to `now`, including a running spell.
async function liveUsedMinutes(row, c, now = new Date()) {
  const used = row[`${c}UsedMinutes`] || 0;
  if (!row[`${c}RunningSince`]) return used;
  const policy = await slaCalendar.getPolicy(row.slaPolicyId);
  return used + businessMinutesBetween(row[`${c}RunningSince`], now, calendarFor(policy, row.ticketType, row.priority));
}

module.exports = {
  onTicketCreated, onTicketUpdated, recordFirstResponse, recalcTicketSla, syncTicketSla, changeDueDate, liveUsedMinutes,
};
