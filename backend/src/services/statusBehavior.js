const { TicketStatus, ProjectStatus } = require('../models');

// Fetches every ticket status once and buckets their NAMES by behaviorType
// ('open' | 'closed' | 'archived'). Used everywhere that needs to know
// whether a given ticket.status value counts as open/closed/archived
// without hardcoding a fixed list of status name strings — a custom status
// an admin creates (or renames) is picked up immediately because this reads
// the ticket_statuses table directly rather than a baked-in constant.
//
// The "on hold" kind (user decision 2026-10-15) never counts as closed, so
// it is reported as open here and every caller (SLA clocks, overdue, open
// lists) treats it that way; `onHold` names those statuses for the places
// that show it separately.
async function getTicketStatusBuckets() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType'] });
  const buckets = {
    open: [], closed: [], archived: [], onHold: [],
  };
  rows.forEach((r) => {
    if (r.behaviorType === 'on_hold') {
      buckets.open.push(r.name);
      buckets.onHold.push(r.name);
    } else if (buckets[r.behaviorType]) buckets[r.behaviorType].push(r.name);
  });
  return buckets;
}

// Same, but as a Map<statusName, behaviorType> for O(1) per-ticket lookups
// (e.g. when classifying a list of tickets one at a time). On hold → 'open'.
async function getTicketStatusBehaviorMap() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType'] });
  return new Map(rows.map((r) => [r.name, r.behaviorType === 'on_hold' ? 'open' : r.behaviorType]));
}

// The real kind, including 'on_hold'.
async function getTicketStatusKindMap() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType'] });
  return new Map(rows.map((r) => [r.name, r.behaviorType]));
}

// Same idea for Project.status (a name string, exactly like Ticket.status).
async function getProjectStatusBuckets() {
  const rows = await ProjectStatus.findAll({ attributes: ['name', 'behaviorType'] });
  const buckets = { open: [], closed: [], archived: [] };
  rows.forEach((r) => {
    if (buckets[r.behaviorType]) buckets[r.behaviorType].push(r.name);
  });
  return buckets;
}

async function getProjectStatusBehaviorMap() {
  const rows = await ProjectStatus.findAll({ attributes: ['name', 'behaviorType'] });
  return new Map(rows.map((r) => [r.name, r.behaviorType]));
}

// The row a task/project should move to when auto-completed or auto-closed
// (e.g. the checkbox on a task, or "Close project" on the all-tasks-done
// prompt) — the first status row with the given behaviorType, ordered by
// its admin-configured position.
async function getFirstProjectStatusByBehavior(behaviorType) {
  return ProjectStatus.findOne({ where: { behaviorType }, order: [['position', 'ASC']] });
}

// Same idea for tickets — used by inbound email processing, which creates
// tickets with no explicit status (there's no form to pick one from), so it
// needs "whatever the admin's first open-behavior status is" rather than a
// hardcoded 'Open' literal (an admin may have renamed or reordered statuses).
async function getFirstTicketStatusByBehavior(behaviorType) {
  return TicketStatus.findOne({ where: { behaviorType }, order: [['position', 'ASC']] });
}

module.exports = {
  getTicketStatusBuckets,
  getTicketStatusBehaviorMap,
  getTicketStatusKindMap,
  getProjectStatusBuckets,
  getProjectStatusBehaviorMap,
  getFirstProjectStatusByBehavior,
  getFirstTicketStatusByBehavior,
};
