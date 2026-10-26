// The one task service (sub-project 3): create, edit, delete, reorder and
// renumber, with the same rules for ticket tasks and project tasks. The
// ticket and project controllers only find the parent and check access.
const { Op } = require('sequelize');
const {
  Task, TaskAssignee, TaskStatus, ProjectPhase, TimeEntry, ActiveTimer, ProjectExpense, ProjectMaterial, ProjectFile, User, Ticket, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../ticketActivity');
const { logProjectActivity } = require('../projectActivity');
const { canWorkCompany } = require('../ticketPeople');
const {
  parseRecordId, findAccessibleTicket, parseTicketId, canAccessTicket,
} = require('../permissionService');
const { defaultTaskStatus, findTaskStatus, taskStatusBehaviorMap } = require('./statuses');
const {
  formatTaskCode, formatSubtaskCode, trailingNumber, nextCode, pad2,
} = require('./codes');
const { toDateString } = require('../../utils/orgTime');
const { isTaskComplete, subtaskCompletionPercent } = require('../projectCompletion');
const dependencies = require('../projects/dependencies');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const ORDER = [['position', 'ASC'], ['id', 'ASC']];

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const given = (v) => v !== undefined && v !== null && v !== '';

function ticketParent(ticket) {
  return { kind: 'ticket', record: ticket, where: { ticketId: ticket.id }, companyId: ticket.companyId };
}

function projectParent(project) {
  return { kind: 'project', record: project, where: { projectId: project.id }, companyId: project.companyId };
}

// A project task's linked ticket shows only while it's in the project's
// company: a link can outlive a move of either end (plan 2a).
function taskIncludes(parent) {
  // Fresh objects at each level: Sequelize mutates include objects while
  // resolving them, so one object shared by two levels breaks the query.
  const status = () => ({ model: TaskStatus, as: 'status' });
  const assignee = () => ({ model: User, as: 'assignee', attributes: userAttrs });
  // Helpers are project-only (decision 15); the join row is not shown.
  const helpers = () => ({ model: User, as: 'helpers', attributes: userAttrs, through: { attributes: [] } });
  const people = parent.kind === 'project' ? [helpers()] : [];
  const linked = parent.kind === 'project'
    ? [{ model: Ticket, as: 'linkedTicket', attributes: ['id', 'title', 'departmentId', 'assigneeId', 'companyId'], where: { companyId: parent.companyId }, required: false }]
    : [];
  return [
    assignee(), status(), ...people, ...linked,
    { model: Task, as: 'subtasks', separate: true, order: ORDER, include: [assignee(), status(), ...people] },
  ];
}

async function findTask(parent, rawId) {
  const id = parseRecordId(rawId);
  return id ? Task.findOne({ where: { id, ...parent.where } }) : null;
}

// A linked ticket the viewer can't open shows only its id (Q19).
async function shownLinkedTicket(viewer, linked) {
  if (!linked) return linked;
  if (viewer && await canAccessTicket(viewer, linked)) return { id: linked.id, title: linked.title };
  return { id: linked.id, restricted: true };
}

// Seconds logged per task in a parent (each task's own entries).
async function loggedSecondsByTask(parent) {
  const rows = await TimeEntry.findAll({
    where: { ...parent.where, taskId: { [Op.ne]: null } },
    attributes: ['taskId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'seconds']],
    group: ['taskId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.taskId, Number(r.seconds) || 0]));
}

// Distinct people with time on each task (each task's own entries), as
// Map(taskId -> Set(userId)).
async function loggersByTask(parent) {
  const rows = await TimeEntry.findAll({
    where: { ...parent.where, taskId: { [Op.ne]: null } },
    attributes: ['taskId', 'userId'],
    group: ['taskId', 'userId'],
    raw: true,
  });
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.taskId)) out.set(r.taskId, new Set());
    out.get(r.taskId).add(r.userId);
  }
  return out;
}

const shownPerson = (u) => ({ id: u.id, name: u.displayName || u.username, avatar: null });

// logged: loggedSecondsByTask. A task's loggedSeconds counts its subtasks'.
// loggers: loggersByTask. Hours are person-hours: loggedSeconds is everyone's
// time and loggedBy counts the people behind it.
// graph: dependencies.loadGraph (project tasks only).
async function annotate(task, behavior, viewer, logged = new Map(), loggers = new Map(), graph = null) {
  const json = task.toJSON();
  const subs = task.subtasks || [];
  json.loggedSeconds = (logged.get(task.id) || 0) + subs.reduce((n, st) => n + (logged.get(st.id) || 0), 0);
  json.loggedBy = new Set([task.id, ...subs.map((st) => st.id)].flatMap((id) => [...(loggers.get(id) || [])])).size;
  if (Array.isArray(json.helpers)) json.helpers = json.helpers.map(shownPerson);
  if (Array.isArray(json.subtasks)) {
    json.subtasks = json.subtasks.map((st) => ({
      ...st,
      loggedSeconds: logged.get(st.id) || 0,
      loggedBy: (loggers.get(st.id) || new Set()).size,
      ...(Array.isArray(st.helpers) ? { helpers: st.helpers.map(shownPerson) } : {}),
    }));
  }
  if (json.parentTaskId === null) {
    json.isComplete = isTaskComplete(task, task.subtasks || [], behavior);
    json.subtaskPercent = subtaskCompletionPercent(task.subtasks || [], behavior);
  }
  if (graph && json.parentTaskId === null) Object.assign(json, dependencies.linksFor(task.id, graph, behavior));
  if (json.linkedTicket !== undefined) json.linkedTicket = await shownLinkedTicket(viewer, task.linkedTicket);
  return json;
}

// viewer: the user the task is shown to, for the linked ticket (Q19).
async function loadTask(parent, id, viewer) {
  const task = await Task.findByPk(id, { include: taskIncludes(parent) });
  const graph = parent.kind === 'project' ? await dependencies.loadGraph(parent.record.id) : null;
  return annotate(task, await taskStatusBehaviorMap(), viewer, await loggedSecondsByTask(parent), await loggersByTask(parent), graph);
}

// Top-level tasks of a project where this user is the main assignee or a
// helper, on the task or on one of its subtasks (the subtasks all still show).
async function topTaskIdsFor(parent, userId) {
  const helping = await TaskAssignee.findAll({ where: { userId }, attributes: ['taskId'], raw: true });
  const rows = await Task.findAll({
    where: { ...parent.where, [Op.or]: [{ assigneeId: userId }, { id: helping.map((h) => h.taskId) }] },
    attributes: ['id', 'parentTaskId'],
    raw: true,
  });
  return [...new Set(rows.map((r) => r.parentTaskId || r.id))];
}

// options.mine: a user id; keeps only the tasks that user works on.
async function listTasks(parent, viewer, { mine } = {}) {
  const where = { ...parent.where, parentTaskId: null };
  if (given(mine)) {
    const userId = parseRecordId(mine);
    if (!userId) throw bad('mine must be a user id');
    where.id = parent.kind === 'project' ? await topTaskIdsFor(parent, userId) : (await Task.findAll({ where: { ...parent.where, assigneeId: userId }, attributes: ['id'], raw: true })).map((t) => t.id);
  }
  const tasks = await Task.findAll({ where, include: taskIncludes(parent), order: ORDER });
  const behavior = await taskStatusBehaviorMap();
  const logged = await loggedSecondsByTask(parent);
  const loggers = await loggersByTask(parent);
  const graph = parent.kind === 'project' ? await dependencies.loadGraph(parent.record.id) : null;
  return Promise.all(tasks.map((t) => annotate(t, behavior, viewer, logged, loggers, graph)));
}

// ---- Field rules ----

function cleanTitle(value, label) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw bad(`${label} title is required`);
  return title;
}

function cleanText(value) {
  if (!given(value)) return null;
  const text = String(value).trim();
  return text || null;
}

function resolvePriority(value) {
  if (!PRIORITIES.includes(value)) throw bad('Invalid priority');
  return value;
}

// Strict 'YYYY-MM-DD' only (no timestamps, no impossible days).
function resolveDate(value, label) {
  if (!given(value)) return null;
  const date = typeof value === 'string' && value.length === 10 ? toDateString(value) : null;
  if (!date) throw bad(`Invalid ${label}`);
  return date;
}
const resolveDueDate = (value) => resolveDate(value, 'due date');

function resolveEstimate(value) {
  if (!given(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw bad('Estimate must be a whole number of minutes');
  return n;
}

async function resolveStatus(parent, value) {
  const status = await findTaskStatus(parent.kind, value);
  if (!status) throw bad('Unknown task status');
  return status;
}

// The assignee must be able to open the parent (plan 2b rule). Re-sending
// the current assignee isn't re-checked: a client PATCHing the whole task
// back mustn't be refused for an assignment it didn't make.
async function resolveAssignee(parent, value, current) {
  if (!given(value)) return null;
  const id = parseRecordId(value);
  if (id && id === current) return current;
  const user = id && await canWorkCompany(id, parent.companyId);
  if (!user) throw bad(`Assignee can't see ${parent.kind}s for this company`);
  return user.id;
}

// Project tasks only. Missing and out-of-scope tickets look the same, and
// the checked ticket's own id is what gets stored (S4).
async function resolveLinkedTicket(req, parent, value, current) {
  if (!given(value)) return null;
  if (parent.kind !== 'project') throw bad('Only project tasks can link a ticket');
  if (current && parseTicketId(value) === current) return current;
  const linked = await findAccessibleTicket(req.user, value);
  if (!linked || linked.companyId !== parent.companyId) throw bad('Linked ticket not found');
  return linked.id;
}

// ---- Project-only fields: phase, start date, milestone (sub-project 6) ----

const projectOnly = (message) => new ApiError(400, message, 'PROJECT_TASK_ONLY');
const milestoneHasSubtasks = () => new ApiError(400, "A milestone can't have subtasks", 'MILESTONE_HAS_SUBTASKS');
const PROJECT_ONLY_FIELDS = ['phaseId', 'startDate', 'isMilestone'];

// A ticket task refuses a real value for these (a client sending the task
// back whole, with the empty defaults, is not refused).
function refuseProjectOnly(parent, body) {
  if (parent.kind === 'project') return;
  const sent = PROJECT_ONLY_FIELDS.filter((k) => given(body[k]) && body[k] !== false);
  if (sent.length) throw projectOnly(`${sent.join(', ')} can only be set on project tasks`);
}

// The phase must be in this project, else 404 — checked before any other
// validation. null clears it.
async function resolvePhase(parent, value) {
  if (!given(value)) return null;
  const id = parseRecordId(value);
  const phase = id && await ProjectPhase.findOne({ where: { id, projectId: parent.record.id } });
  if (!phase) throw new ApiError(404, 'Phase not found', 'NOT_FOUND');
  return phase.id;
}

const resolveStartDate = (value) => resolveDate(value, 'start date');

function resolveMilestoneFlag(value) {
  if (typeof value !== 'boolean') throw bad('isMilestone must be true or false');
  return value;
}

// Dates and estimate after the change, for a task whose effective state is
// `now` (existing values merged with the body). A milestone has one date and
// no estimate; any other task needs start <= due.
function settleDates(body, now, becomingMilestone) {
  const out = { startDate: now.startDate, dueDate: now.dueDate, estimateMinutes: now.estimateMinutes };
  if (body.startDate !== undefined) out.startDate = resolveStartDate(body.startDate);
  if (body.dueDate !== undefined) out.dueDate = resolveDueDate(body.dueDate);
  if (now.isMilestone) {
    const anySent = body.startDate !== undefined || body.dueDate !== undefined;
    const sent = [body.dueDate !== undefined && out.dueDate, body.startDate !== undefined && out.startDate].filter(Boolean);
    if (sent.length === 2 && sent[0] !== sent[1]) throw bad('A milestone has a single date');
    // Only one date sent: both take it. Clearing the only date clears both.
    out.startDate = anySent ? sent[0] || null : out.dueDate || out.startDate;
    out.dueDate = out.startDate;
    out.estimateMinutes = null;
  } else if (out.startDate && out.dueDate && out.startDate > out.dueDate) {
    throw new ApiError(400, 'Start date is after the due date', 'START_AFTER_DUE');
  }
  return out;
}

// ---- Activity and audit (Q8, Q23) ----

async function recordTaskEvent(req, parent, task, event, extra = {}) {
  const sub = !!task.parentTaskId;
  const action = `${sub ? 'subtask' : 'task'}_${event}`;
  if (parent.kind === 'ticket') {
    const toValue = extra.to !== undefined ? extra.to : `${task.code} ${task.title}`;
    await logActivity(parent.record.id, req.user.id, action, extra.from ?? null, toValue);
  } else {
    const detail = sub
      ? { subtaskId: task.id, title: task.title, subtaskCode: task.code }
      : { taskId: task.id, title: task.title, taskCode: task.code };
    await logProjectActivity(parent.record.id, req.user.id, action, { ...detail, ...(extra.detail || {}) });
  }
}

function audit(req, parent, verb, task, meta = {}) {
  return writeAudit(req, `task.${verb}`, 'Task', task.id, { ...parent.where, ...meta });
}

// ---- Create / update / delete ----

async function createTask(req, parent, body = {}) {
  refuseProjectOnly(parent, body);
  const phaseId = parent.kind === 'project' && !given(body.parentTaskId) ? await resolvePhase(parent, body.phaseId) : null;
  let parentTask = null;
  if (given(body.parentTaskId)) {
    parentTask = await findTask(parent, body.parentTaskId);
    if (!parentTask) throw bad('Parent task not found');
    if (parentTask.parentTaskId) throw bad("Subtasks can't have subtasks");
    if (parentTask.isMilestone) throw milestoneHasSubtasks();
  }
  const isMilestone = parent.kind === 'project' && body.isMilestone !== undefined ? resolveMilestoneFlag(body.isMilestone) : false;
  if (isMilestone && parentTask) throw bad("A subtask can't be a milestone");
  const title = cleanTitle(body.title, parentTask ? 'Subtask' : 'Task');
  const status = given(body.statusId) ? await resolveStatus(parent, body.statusId) : await defaultTaskStatus(parent.kind);
  if (!status) throw bad('No open task status is configured');
  const fields = {
    ...parent.where,
    parentTaskId: parentTask ? parentTask.id : null,
    title,
    description: cleanText(body.description),
    statusId: status.id,
    priority: given(body.priority) ? resolvePriority(body.priority) : 'medium',
    assigneeId: await resolveAssignee(parent, body.assigneeId, null),
    ...settleDates(
      { startDate: body.startDate, dueDate: body.dueDate },
      { startDate: null, dueDate: null, estimateMinutes: resolveEstimate(body.estimateMinutes), isMilestone },
    ),
    phaseId,
    isMilestone,
    linkedTicketId: await resolveLinkedTicket(req, parent, body.linkedTicketId, null),
    completedAt: status.behaviorType === 'closed' ? new Date() : null, // Q31
    createdBy: req.user.id,
  };
  const siblings = { ...parent.where, parentTaskId: fields.parentTaskId };
  const task = await sequelize.transaction(async (transaction) => {
    const maxPos = await Task.max('position', { where: siblings, transaction });
    const code = await nextCode(parent, parentTask, transaction);
    return Task.create({ ...fields, code, position: (Number.isFinite(maxPos) ? maxPos : 0) + 1 }, { transaction });
  });
  await recordTaskEvent(req, parent, task, 'created');
  await audit(req, parent, 'create', task, { title: task.title, code: task.code });
  return loadTask(parent, task.id, req.user);
}

const sameDate = (a, b) => (a || null) === (b || null);

// Milestone flag, start date, due date and estimate of a project task,
// settled together (a milestone keeps one date and no estimate).
async function applyProjectFields(task, body, changes) {
  let isMilestone = task.isMilestone;
  if (body.isMilestone !== undefined) {
    isMilestone = resolveMilestoneFlag(body.isMilestone);
    if (isMilestone && task.parentTaskId) throw bad("A subtask can't be a milestone");
    if (isMilestone && !task.isMilestone && await Task.count({ where: { parentTaskId: task.id } })) throw milestoneHasSubtasks();
    changes.isMilestone = isMilestone;
  }
  const touched = ['startDate', 'dueDate'].some((k) => body[k] !== undefined) || changes.isMilestone === true || changes.estimateMinutes !== undefined;
  if (!touched) return;
  const now = {
    startDate: task.startDate || null,
    dueDate: task.dueDate || null,
    estimateMinutes: changes.estimateMinutes !== undefined ? changes.estimateMinutes : task.estimateMinutes,
    isMilestone,
  };
  Object.assign(changes, settleDates(body, now));
}

async function updateTask(req, parent, task, body = {}) {
  refuseProjectOnly(parent, body);
  const label = task.parentTaskId ? 'Subtask' : 'Task';
  const changes = {};
  if (parent.kind === 'project' && body.phaseId !== undefined) {
    // A subtask follows its parent: a phase sent for it is ignored.
    const phaseId = await resolvePhase(parent, body.phaseId);
    if (!task.parentTaskId) changes.phaseId = phaseId;
  }
  if (body.title !== undefined) changes.title = cleanTitle(body.title, label);
  if (body.description !== undefined) changes.description = cleanText(body.description);
  if (body.priority !== undefined) changes.priority = resolvePriority(body.priority);
  if (body.estimateMinutes !== undefined) changes.estimateMinutes = resolveEstimate(body.estimateMinutes);
  if (parent.kind === 'project') await applyProjectFields(task, body, changes);
  else if (body.dueDate !== undefined) changes.dueDate = resolveDueDate(body.dueDate);
  if (body.assigneeId !== undefined) changes.assigneeId = await resolveAssignee(parent, body.assigneeId, task.assigneeId);
  if (body.linkedTicketId !== undefined) {
    changes.linkedTicketId = await resolveLinkedTicket(req, parent, body.linkedTicketId, task.linkedTicketId);
  }
  let statusEvent = null;
  if (body.statusId !== undefined) {
    const status = await resolveStatus(parent, body.statusId);
    if (status.id !== task.statusId) { // Q7, Q15: the same status is no change
      const wasClosed = (await taskStatusBehaviorMap()).get(task.statusId) === 'closed';
      const willClose = status.behaviorType === 'closed';
      changes.statusId = status.id;
      changes.completedAt = willClose ? (wasClosed ? task.completedAt : new Date()) : null;
      if (willClose !== wasClosed) statusEvent = willClose ? 'closed' : 'reopened';
    }
  }
  // Keep only real changes, so a client PATCHing the whole task back logs nothing.
  for (const key of Object.keys(changes)) {
    const same = key === 'dueDate' || key === 'startDate' ? sameDate(changes[key], task[key]) : changes[key] === task[key];
    if (same && key !== 'completedAt') delete changes[key];
  }
  if (changes.statusId === undefined) delete changes.completedAt;
  // A status change that stays on the same side (To do -> In progress) is an
  // ordinary edit; crossing into or out of closed has its own event.
  const fields = Object.keys(changes).filter((k) => k !== 'completedAt' && !(k === 'statusId' && statusEvent));
  if (!Object.keys(changes).length) return loadTask(parent, task.id, req.user);

  const oldDue = task.dueDate || null;
  await task.update(changes);
  // A new main assignee who was a helper is no longer one (decision 15).
  if (changes.assigneeId) await TaskAssignee.destroy({ where: { taskId: task.id, userId: changes.assigneeId } });
  if (statusEvent) await recordTaskEvent(req, parent, task, statusEvent);
  if (fields.length) {
    await recordTaskEvent(req, parent, task, 'updated', { from: null, to: fields.join(', '), detail: { fields } });
  }
  await audit(req, parent, 'update', task, { fields: Object.keys(changes) });
  if (parent.kind === 'project' && statusEvent === 'closed') {
    // The task is saved; a failed notice must not turn that into a 500.
    try { await dependencies.notifyUnblocked(task, req.user.id); } catch (err) { console.error('[tasks] unblocked notice failed:', err.message); }
  }
  const json = await loadTask(parent, task.id, req.user);
  // A due date moved later: offer to move what waits on this task by as much.
  const offer = parent.kind === 'project' && changes.dueDate !== undefined
    ? await dependencies.shiftOffer(parent.record, task, oldDue, task.dueDate || null) : null;
  if (offer) json.shiftOffer = offer;
  return json;
}

// The task and its subtasks go; their time, expenses, materials, files and
// running timers stay, on no task (the work happened).
async function deleteTask(req, parent, task) {
  // Lazy: projects/helpers loads this module.
  const projectHelpers = parent.kind === 'project' ? require('../projects/helpers') : null; // eslint-disable-line global-require
  const dropped = await sequelize.transaction(async (transaction) => {
    const subtasks = await Task.findAll({ where: { parentTaskId: task.id }, attributes: ['id'], transaction });
    const ids = [task.id, ...subtasks.map((s) => s.id)];
    const unlink = [TimeEntry, ActiveTimer, ...(parent.kind === 'project' ? [ProjectExpense, ProjectMaterial, ProjectFile] : [])];
    for (const Model of unlink) {
      await Model.update({ taskId: null }, { where: { taskId: ids }, transaction }); // eslint-disable-line no-await-in-loop
    }
    const helperIds = projectHelpers
      ? (await TaskAssignee.findAll({ where: { taskId: ids }, attributes: ['userId'], raw: true, transaction })).map((r) => r.userId)
      : [];
    await TaskAssignee.destroy({ where: { taskId: ids }, transaction });
    await Task.destroy({ where: { id: ids }, transaction });
    // Helpers whose last task in the project this was lose the membership (R17).
    return projectHelpers ? projectHelpers.dropIdleHelperMemberships(parent.record.id, helperIds, transaction) : [];
  });
  await recordTaskEvent(req, parent, task, 'deleted');
  await audit(req, parent, 'delete', task, { title: task.title, code: task.code });
  if (dropped.length) await projectHelpers.auditAutoRemoved(req, parent.record.id, dropped, { taskId: task.id });
}

// ---- Reorder and renumber ----

// Body: { order: [taskId, ...], parentTaskId? } — every task at that level,
// exactly once (Q32), so positions stay a clean 1..n.
async function reorderTasks(req, parent, body = {}) {
  const order = Array.isArray(body.order) ? body.order.map(parseRecordId) : [];
  if (!order.length || order.some((id) => !id)) throw bad('order must be a non-empty array of task IDs');
  let parentTaskId = null;
  if (given(body.parentTaskId)) {
    const parentTask = await findTask(parent, body.parentTaskId);
    if (!parentTask || parentTask.parentTaskId) throw bad('Parent task not found');
    parentTaskId = parentTask.id;
  }
  const siblings = await Task.findAll({ where: { ...parent.where, parentTaskId }, attributes: ['id'] });
  const siblingIds = new Set(siblings.map((s) => s.id));
  if (order.some((id) => !siblingIds.has(id))) {
    const ofWhat = parentTaskId ? 'this task' : `this ${parent.kind}`;
    throw bad(`One or more tasks do not belong to ${ofWhat}`);
  }
  if (new Set(order).size !== order.length || order.length !== siblingIds.size) {
    throw bad('order must list every task at this level exactly once');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [idx, id] of order.entries()) {
      await Task.update({ position: idx + 1 }, { where: { id }, transaction }); // eslint-disable-line no-await-in-loop
    }
  });
  if (parent.kind === 'ticket') await logActivity(parent.record.id, req.user.id, 'tasks_reordered', null, null);
  else await logProjectActivity(parent.record.id, req.user.id, 'tasks_reordered', { parentTaskId });
  await writeAudit(req, 'task.reorder', 'Task', parentTaskId, { ...parent.where, parentTaskId, order });
}

async function renumberTask(req, parent, task, rawNumber) {
  const sub = !!task.parentTaskId;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw bad(`${sub ? 'Subtask' : 'Task'} number must be between 1 and 99`);
  }
  const parentTask = sub ? await Task.findByPk(task.parentTaskId) : null;
  const newCode = sub ? formatSubtaskCode(parentTask.code, number) : formatTaskCode(parent, number);
  if (newCode === task.code) return loadTask(parent, task.id, req.user);
  if (await Task.findOne({ where: { code: newCode, id: { [Op.ne]: task.id } } })) {
    throw sub
      ? new ApiError(409, `Subtask S${pad2(number)} already exists in this task. Choose a different number.`, 'SUBTASK_CODE_CONFLICT')
      : new ApiError(409, `Task T${pad2(number)} already exists in this ${parent.kind}. Choose a different number.`, 'TASK_CODE_CONFLICT');
  }
  const oldCode = task.code;
  await sequelize.transaction(async (transaction) => {
    await task.update({ code: newCode }, { transaction });
    if (!sub) { // Q20: subtasks follow their task's new number
      const subtasks = await Task.findAll({ where: { parentTaskId: task.id }, order: ORDER, transaction });
      for (const [i, s] of subtasks.entries()) {
        const n = trailingNumber(s.code, 'S') || i + 1;
        await s.update({ code: formatSubtaskCode(newCode, n) }, { transaction }); // eslint-disable-line no-await-in-loop
      }
    }
  });
  await recordTaskEvent(req, parent, task, 'renumbered', { from: oldCode, to: newCode, detail: { fromCode: oldCode } });
  await audit(req, parent, 'renumber', task, { from: oldCode, to: newCode });
  return loadTask(parent, task.id, req.user);
}

module.exports = {
  ticketParent, projectParent, findTask, listTasks, loadTask,
  createTask, updateTask, deleteTask, reorderTasks, renumberTask,
};
