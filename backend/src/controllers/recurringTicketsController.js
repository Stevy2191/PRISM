// Recurring tickets (service desk 5b): a ticket template plus a schedule.
// Every route needs tickets.recurring.manage (the router checks it).
//
// Security: a rule's template is checked against the access of whoever saves
// it, and the rule then runs as that person (createdById, shown as "runs
// as"), re-checked at every run. A rule whose contact the viewer can't reach
// is hidden, and every by-id route answers for it exactly as for a missing
// rule.
const { RecurringTicket, User, Contact } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const {
  findAccessibleContact, canAccessContact, getUserCompanyIds, parseRecordId,
} = require('../services/permissionService');
const { findDepartmentInCompany } = require('../services/companyService');
const { assertCanWorkTicket } = require('../services/ticketPeople');
const { assertTeamExists } = require('../services/tickets/ticketWrite');
const { nextRun, previewRuns, validateSchedule } = require('../services/recurring/schedule');
const { runRule } = require('../services/recurring/runRule');
const { orgTimeZone } = require('../utils/orgTime');

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['incident', 'request', 'problem', 'task', 'change'];
const SCHEDULE_FIELDS = ['frequency', 'interval', 'weekdays', 'dayOfMonth', 'monthOfYear', 'timeOfDay', 'timezone', 'startDate', 'endDate'];
const TEMPLATE_FIELDS = ['title', 'description', 'priority', 'type', 'contactId', 'departmentId', 'teamId', 'assigneeId', 'tasks'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const notFound = () => new ApiError(404, 'Recurring ticket not found', 'NOT_FOUND');

const include = [
  { model: User, as: 'createdBy', attributes: ['id', 'displayName'] },
  { model: Contact, as: 'contact', attributes: ['id', 'displayName', 'firstName', 'lastName', 'companyId', 'departmentId', 'createdBy'] },
];

// Whether `viewer` may see a rule: its contact must be one they can reach.
// A rule whose contact is gone is shown only to unfenced viewers.
async function canSeeRule(viewer, rule) {
  if (rule.contact) return canAccessContact(viewer, rule.contact);
  return (await getUserCompanyIds(viewer)) === null;
}

async function findVisible(req) {
  const id = parseRecordId(req.params.id);
  const rule = id ? await RecurringTicket.findByPk(id, { include }) : null;
  if (!rule || !(await canSeeRule(req.user, rule))) throw notFound();
  return rule;
}

const shown = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  priority: r.priority,
  type: r.type,
  contactId: r.contactId,
  contact: r.contact ? { id: r.contact.id, displayName: r.contact.displayName || [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' ') } : null,
  departmentId: r.departmentId,
  teamId: r.teamId,
  assigneeId: r.assigneeId,
  tasks: r.tasks || [],
  ...Object.fromEntries(SCHEDULE_FIELDS.map((f) => [f, r[f]])),
  nextRunAt: r.nextRunAt,
  lastRunAt: r.lastRunAt,
  lastTicketId: r.lastTicketId,
  lastError: r.lastError,
  active: r.active,
  runsAs: r.createdBy ? { id: r.createdBy.id, displayName: r.createdBy.displayName } : null,
});

// The template, checked against the saver exactly as a new ticket would be.
async function cleanTemplate(user, input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 255) throw bad('Title is required (at most 255 characters)');
  const description = input.description === null || input.description === undefined ? null : String(input.description);
  if (description && description.length > 20000) throw bad('Description is at most 20,000 characters');
  const priority = input.priority || 'medium';
  if (!PRIORITIES.includes(priority)) throw bad('Unknown priority');
  const type = input.type || 'request';
  if (!TYPES.includes(type)) throw bad('Unknown ticket type');
  const contact = input.contactId ? await findAccessibleContact(user, input.contactId) : null;
  if (!contact) throw bad('Contact not found');
  let departmentId = null;
  if (input.departmentId) {
    const dept = await findDepartmentInCompany(input.departmentId, contact.companyId);
    if (!dept) throw bad('Department not found');
    departmentId = dept.id;
  }
  const teamId = await assertTeamExists(input.teamId);
  const assigneeId = input.assigneeId ? await assertCanWorkTicket(input.assigneeId, contact.companyId, 'Assignee') : null;
  const list = input.tasks === null || input.tasks === undefined ? [] : input.tasks;
  if (!Array.isArray(list) || list.length > 50
    || !list.every((t) => typeof t === 'string' && t.trim() && t.trim().length <= 255)) {
    throw bad('Tasks must be up to 50 titles of at most 255 characters');
  }
  return {
    title, description, priority, type, contactId: contact.id, departmentId, teamId, assigneeId, tasks: list.map((t) => t.trim()),
  };
}

// The whole rule from a body merged over the current values, checked
// against the saver, who becomes the person it runs as.
async function cleanRule(req, body, current = null) {
  const pick = (fields) => Object.fromEntries(fields.map((f) => [f, body[f] !== undefined ? body[f] : current && current[f]]));
  const template = await cleanTemplate(req.user, pick(TEMPLATE_FIELDS));
  const scheduleInput = pick(SCHEDULE_FIELDS);
  if (!scheduleInput.timezone) scheduleInput.timezone = await orgTimeZone();
  const schedule = validateSchedule(scheduleInput);
  const next = nextRun(schedule, new Date());
  const active = body.active !== undefined ? body.active === true : (current ? current.active : true);
  return {
    ...template, ...schedule, createdById: req.user.id, nextRunAt: next, lastError: null, active: active && !!next,
  };
}

// GET /recurring-tickets
const list = asyncHandler(async (req, res) => {
  const rows = await RecurringTicket.findAll({ include, order: [['title', 'ASC'], ['id', 'ASC']] });
  const visible = [];
  for (const r of rows) {
    if (await canSeeRule(req.user, r)) visible.push(shown(r)); // eslint-disable-line no-await-in-loop
  }
  res.json({ rules: visible });
});

// GET /recurring-tickets/:id
const get = asyncHandler(async (req, res) => {
  res.json({ rule: shown(await findVisible(req)) });
});

// POST /recurring-tickets
const create = asyncHandler(async (req, res) => {
  const data = await cleanRule(req, req.body || {});
  const row = await RecurringTicket.create(data);
  await writeAudit(req, 'recurring.create', 'RecurringTicket', row.id, { title: row.title });
  res.status(201).json({ rule: shown(await RecurringTicket.findByPk(row.id, { include })) });
});

// PATCH /recurring-tickets/:id. Only { active } pauses or resumes without
// re-saving the contents (the rule keeps running as the same person);
// anything else is a save, checked against and run as the saver.
const update = asyncHandler(async (req, res) => {
  const rule = await findVisible(req);
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === 'active') {
    if (typeof body.active !== 'boolean') throw bad('active must be true or false');
    const changes = { active: body.active };
    if (body.active) {
      changes.nextRunAt = nextRun(rule, new Date());
      changes.lastError = null;
      if (!changes.nextRunAt) throw bad('This rule has ended; change its end date to resume it');
    }
    await rule.update(changes);
    await writeAudit(req, body.active ? 'recurring.resume' : 'recurring.pause', 'RecurringTicket', rule.id, null);
  } else {
    const data = await cleanRule(req, body, rule);
    await rule.update(data);
    await writeAudit(req, 'recurring.update', 'RecurringTicket', rule.id, { title: rule.title });
  }
  res.json({ rule: shown(await RecurringTicket.findByPk(rule.id, { include })) });
});

// DELETE /recurring-tickets/:id
const remove = asyncHandler(async (req, res) => {
  const rule = await findVisible(req);
  await rule.destroy();
  await writeAudit(req, 'recurring.delete', 'RecurringTicket', rule.id, { title: rule.title });
  res.json({ ok: true });
});

// POST /recurring-tickets/:id/run — one ticket now; the schedule is untouched.
const runNow = asyncHandler(async (req, res) => {
  const rule = await findVisible(req);
  const ticket = await runRule(rule);
  await writeAudit(req, 'recurring.run', 'RecurringTicket', rule.id, { ticketId: ticket.id });
  res.status(201).json({ ticket });
});

// POST /recurring-tickets/preview { schedule } → the next five runs.
const preview = asyncHandler(async (req, res) => {
  const input = { ...((req.body || {}).schedule || {}) };
  if (!input.timezone) input.timezone = await orgTimeZone();
  const schedule = validateSchedule(input);
  res.json({ runs: previewRuns(schedule, new Date(), 5) });
});

module.exports = {
  list, get, create, update, remove, runNow, preview,
};
