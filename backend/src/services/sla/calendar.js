// Loads what the SLA clocks need about a company's SLA row (CS) — its
// targets, warning point, support hours, time zone and holidays — with a
// small in-process cache (single backend instance). Any write to a row, its
// targets or its holidays calls invalidate().
const { SlaPolicy, SlaTarget, Holiday } = require('../../models');
const { isValidZone } = require('../../utils/orgTime');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// A schedule the clocks can count on: a real zone and at least one open day
// with valid times. Anything else is treated as 24x7 (and logged) rather
// than letting every ticket save fail.
function usableSchedule(bh) {
  if (bh.is24x7) return true;
  if (!isValidZone(bh.timezone)) return false;
  const schedule = bh.schedule || {};
  return DAYS.some((d) => {
    const day = schedule[d];
    return day && day.enabled && HHMM.test(day.start) && HHMM.test(day.end) && day.end > day.start;
  });
}

let cache = new Map();

function invalidate() {
  cache = new Map();
}

async function loadCalendar(policy, transaction) {
  if (policy.is24x7) return null;
  if (!usableSchedule(policy)) {
    console.warn(`[sla] the support hours of SLA ${policy.id} have no usable open hours; its clocks count every hour`);
    return null;
  }
  const holidays = (await Holiday.findAll({ where: { slaPolicyId: policy.id }, attributes: ['date'], transaction })).map((h) => String(h.date).slice(0, 10));
  return {
    timezone: policy.timezone || 'UTC', schedule: policy.schedule || {}, is24x7: false, holidays: new Set(holidays),
  };
}

// → { id, name, warnAtPercent, timezone, calendar, targets: Map<'type:priority', SlaTarget> } or null.
// Pass the caller's transaction: a ticket save holds one connection, and a
// lookup on a second one can starve the pool under concurrent saves.
async function getPolicy(policyId, transaction) {
  if (!policyId) return null;
  if (cache.has(policyId)) return cache.get(policyId);
  const policy = await SlaPolicy.findByPk(policyId, { include: [{ model: SlaTarget, as: 'targets' }], transaction });
  const value = policy ? {
    id: policy.id,
    name: policy.name,
    warnAtPercent: policy.warnAtPercent,
    timezone: policy.timezone || 'UTC',
    calendar: await loadCalendar(policy, transaction),
    targets: new Map(policy.targets.map((t) => [`${t.ticketType}:${t.priority}`, t.toJSON()])),
  } : null;
  cache.set(policyId, value);
  return value;
}

// The starting values: what a ticket uses when its company has no row yet.
async function getDefaultPolicyId(transaction) {
  const row = await SlaPolicy.findOne({ where: { companyId: null }, order: [['isDefault', 'DESC'], ['id', 'ASC']], attributes: ['id'], transaction });
  return row ? row.id : null;
}

module.exports = { invalidate, getPolicy, getDefaultPolicyId };
