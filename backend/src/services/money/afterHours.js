// Is a time entry after hours? (Phase 3, step 1.) A technician's override
// wins; otherwise its start time against the customer's SLA support hours and
// holidays. An entry with no start time (a plain duration) is in hours.
const { getPolicy } = require('../sla/calendar');
const { policyIdForCompany } = require('../sla/companySla');
const { isOpenAt } = require('../sla/businessTime');

async function isAfterHours(entry, companyId) {
  if (entry.afterHours === true || entry.afterHours === false) return entry.afterHours;
  if (!entry.startTime) return false;
  const policy = await getPolicy(await policyIdForCompany(companyId));
  return !isOpenAt(entry.startTime, policy ? policy.calendar : null);
}

module.exports = { isAfterHours };
