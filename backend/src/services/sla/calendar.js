// Loads what the SLA clocks need about a policy — its per-priority targets,
// warning point and business-hours calendar — with a small in-process cache
// (single backend instance). Any write to policies, targets, business hours
// or holidays calls invalidate().
const { SlaPolicy, SlaTarget, BusinessHours, Holiday } = require('../../models');

let cache = new Map();

function invalidate() {
  cache = new Map();
}

async function loadCalendar(businessHoursId) {
  if (!businessHoursId) return null;
  const bh = await BusinessHours.findByPk(businessHoursId);
  if (!bh) return null;
  const holidays = bh.holidayListId
    ? (await Holiday.findAll({ where: { holidayListId: bh.holidayListId }, attributes: ['date'] })).map((h) => String(h.date).slice(0, 10))
    : [];
  return {
    timezone: bh.timezone || 'UTC', schedule: bh.schedule || {}, is24x7: !!bh.is24x7, holidays: new Set(holidays),
  };
}

// → { id, name, warnAtPercent, calendar, targets: Map<priority, SlaTarget> } or null.
async function getPolicy(policyId) {
  if (!policyId) return null;
  if (cache.has(policyId)) return cache.get(policyId);
  const policy = await SlaPolicy.findByPk(policyId, { include: [{ model: SlaTarget, as: 'targets' }] });
  const value = policy ? {
    id: policy.id,
    name: policy.name,
    warnAtPercent: policy.warnAtPercent,
    calendar: await loadCalendar(policy.businessHoursId),
    targets: new Map(policy.targets.map((t) => [t.priority, t.toJSON()])),
  } : null;
  cache.set(policyId, value);
  return value;
}

async function getDefaultPolicyId() {
  const row = await SlaPolicy.findOne({ where: { isDefault: true }, attributes: ['id'] });
  return row ? row.id : null;
}

module.exports = { invalidate, getPolicy, getDefaultPolicyId };
