const { TicketStatus, ProjectStatus } = require('../models');

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

// ProjectTask/ProjectSubtask.statusId is an integer FK (unlike Project.status),
// so completion logic there needs behaviorType keyed by id, not name.
async function getProjectStatusIdBehaviorMap() {
  const rows = await ProjectStatus.findAll({ attributes: ['id', 'behaviorType'] });
  return new Map(rows.map((r) => [r.id, r.behaviorType]));
}

// The row a task/project should move to when auto-completed or auto-closed
// (e.g. the checkbox on a task, or "Close project" on the all-tasks-done
// prompt) — the first status row with the given behaviorType, ordered by
// its admin-configured position.
async function getFirstProjectStatusByBehavior(behaviorType) {
  return ProjectStatus.findOne({ where: { behaviorType }, order: [['position', 'ASC']] });
}

module.exports = {
  getTicketStatusBuckets,
  getTicketStatusBehaviorMap,
  getProjectStatusBuckets,
  getProjectStatusBehaviorMap,
  getProjectStatusIdBehaviorMap,
  getFirstProjectStatusByBehavior,
};
