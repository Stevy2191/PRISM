const { TicketStatus } = require('../models');

// Fetches every ticket status once and buckets their NAMES by behaviorType
// ('open' | 'closed' | 'archived'). Used everywhere that needs to know
// whether a given ticket.status value counts as open/closed/archived
// without hardcoding a fixed list of status name strings — a custom status
// an admin creates (or renames) is picked up immediately because this reads
// the ticket_statuses table directly rather than a baked-in constant.
async function getTicketStatusBuckets() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType'] });
  const buckets = { open: [], closed: [], archived: [] };
  rows.forEach((r) => {
    if (buckets[r.behaviorType]) buckets[r.behaviorType].push(r.name);
  });
  return buckets;
}

// Same, but as a Map<statusName, behaviorType> for O(1) per-ticket lookups
// (e.g. when classifying a list of tickets one at a time).
async function getTicketStatusBehaviorMap() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType'] });
  return new Map(rows.map((r) => [r.name, r.behaviorType]));
}

module.exports = { getTicketStatusBuckets, getTicketStatusBehaviorMap };
