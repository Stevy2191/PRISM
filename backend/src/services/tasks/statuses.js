// Task statuses: one editable list per scope ('ticket' | 'project'),
// independent of the ticket and project status lists.
const { TaskStatus } = require('../../models');
const { parseRecordId } = require('../permissionService');

const ORDER = [['position', 'ASC'], ['id', 'ASC']];

async function listTaskStatuses(scope) {
  return TaskStatus.findAll({ where: scope ? { scope } : {}, order: ORDER });
}

// What a new task gets when no status is sent: the scope's first open status.
async function defaultTaskStatus(scope) {
  return TaskStatus.findOne({ where: { scope, behaviorType: 'open' }, order: ORDER });
}

// A status in the given scope, or null (a missing id, another scope's id, or
// anything that isn't a plain integer).
async function findTaskStatus(scope, rawId) {
  const id = parseRecordId(rawId);
  return id ? TaskStatus.findOne({ where: { id, scope } }) : null;
}

// id -> behaviorType for every task status (ids are unique across scopes).
async function taskStatusBehaviorMap() {
  const rows = await TaskStatus.findAll({ attributes: ['id', 'behaviorType'] });
  return new Map(rows.map((r) => [r.id, r.behaviorType]));
}

module.exports = { listTaskStatuses, defaultTaskStatus, findTaskStatus, taskStatusBehaviorMap };
