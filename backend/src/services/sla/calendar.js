// Loads what the SLA clocks need about a policy — its per-priority targets,
// warning point and business-hours calendar — with a small in-process cache
// (single backend instance). Any write to policies, targets, business hours
// or holidays calls invalidate().
const { SlaPolicy, SlaTarget, BusinessHours, Holiday } = require('../../models');
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

async function loadCalendar(businessHoursId, transaction) {
  if (!businessHoursId) return null;
  const bh = await BusinessHours.findByPk(businessHoursId, { transaction });
  if (!bh) return null;
  if (!usableSchedule(bh)) {
    console.warn(`[sla] business-hours schedule ${bh.id} has no usable open hours; SLA clocks count every hour`);
    return null;
  }
  const holidays = bh.holidayListId
    ? (await Holiday.findAll({ where: { holidayListId: bh.holidayListId }, attributes: ['date'], transaction })).map((h) => String(h.date).slice(0, 10))
    : [];
  return {
    timezone: bh.timezone || 'UTC', schedule: bh.schedule || {}, is24x7: !!bh.is24x7, holidays: new Set(holidays),
  };
}

// → { id, name, warnAtPercent, calendar, targets: Map<priority, SlaTarget> } or null.
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
    calendar: await loadCalendar(policy.businessHoursId, transaction),
    targets: new Map(policy.targets.map((t) => [t.priority, t.toJSON()])),
  } : null;
  cache.set(policyId, value);
  return value;
}

async function getDefaultPolicyId(transaction) {
  const row = await SlaPolicy.findOne({ where: { isDefault: true }, attributes: ['id'], transaction });
  return row ? row.id : null;
}

module.exports = { invalidate, getPolicy, getDefaultPolicyId };
