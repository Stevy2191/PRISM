// Makes one ticket from a recurring rule (service desk 5b). The ticket is
// checked against the access of the person the rule runs as — whoever last
// saved it (D17) — as it is right now, and credited to the system actor.
const { User } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { hasPermission } = require('../permissionService');
const { createTicket } = require('../tickets/ticketWrite');
const { loadTree, isUsableOnRun } = require('../tickets/categories');
const tasks = require('../tasks');

async function systemActor() {
  // Lazy: the inbound mail module loads a lot this one doesn't need.
  const { getSystemActorUserId } = require('../inboundEmailService'); // eslint-disable-line global-require
  const id = await getSystemActorUserId();
  const actor = id ? await User.findByPk(id) : null;
  if (!actor) throw new ApiError(500, 'No system account to create recurring tickets with', 'NO_SYSTEM_ACTOR');
  return actor;
}

async function runRule(rule, { now = new Date() } = {}) {
  const runAs = await User.findByPk(rule.createdById);
  if (!runAs || !runAs.isActive || !(await hasPermission(runAs.id, 'tickets.create'))) {
    throw new ApiError(400, 'The user this rule runs as can no longer create tickets', 'RECURRING_RUN_AS');
  }
  if (!rule.contactId) throw new ApiError(400, "This rule's contact no longer exists", 'VALIDATION_ERROR');
  const actor = await systemActor();
  const req = { user: actor };
  // A template category retired since the rule was saved is left off: the
  // ticket still gets made and the rule keeps running (the list flags it).
  const categoryId = rule.categoryId && isUsableOnRun(await loadTree(), rule.categoryId) ? rule.categoryId : null;
  const ticket = await createTicket(runAs, {
    title: rule.title,
    description: rule.description,
    priority: rule.priority,
    type: rule.type,
    contactId: rule.contactId,
    departmentId: rule.departmentId,
    teamId: rule.teamId,
    assigneeId: rule.assigneeId,
    categoryId,
  }, { req, createdById: actor.id, source: 'recurring' });
  const parent = tasks.ticketParent(ticket);
  for (const title of Array.isArray(rule.tasks) ? rule.tasks : []) {
    // eslint-disable-next-line no-await-in-loop
    await tasks.createTask(req, parent, { title });
  }
  await rule.update({ lastRunAt: now, lastTicketId: ticket.id });
  return ticket;
}

module.exports = { runRule };
