// The one task service (sub-project 3): create, edit, delete, reorder and
// renumber, with the same rules for ticket tasks and project tasks. The
// ticket and project controllers only find the parent and check access.
const { Op } = require('sequelize');
const {
  Task, TaskStatus, TimeEntry, ActiveTimer, ProjectExpense, ProjectMaterial, ProjectFile, User, Ticket, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../ticketActivity');
const { logProjectActivity } = require('../projectActivity');
const { canWorkCompany } = require('../ticketPeople');
const { parseRecordId, findAccessibleTicket, parseTicketId } = require('../permissionService');
const { defaultTaskStatus, findTaskStatus, taskStatusBehaviorMap } = require('./statuses');
const {
  formatTaskCode, formatSubtaskCode, trailingNumber, nextCode, pad2,
} = require('./codes');
const { toDateString } = require('../../utils/orgTime');
const { isTaskComplete, subtaskCompletionPercent } = require('../projectCompletion');

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
  const linked = parent.kind === 'project'
    ? [{ model: Ticket, as: 'linkedTicket', attributes: ['id', 'title'], where: { companyId: parent.companyId }, required: false }]
    : [];
  return [
    assignee(), status(), ...linked,
    { model: Task, as: 'subtasks', separate: true, order: ORDER, include: [assignee(), status()] },
  ];
}

async function findTask(parent, rawId) {
  const id = parseRecordId(rawId);
  return id ? Task.findOne({ where: { id, ...parent.where } }) : null;
}

function annotate(task, behavior) {
  const json = task.toJSON();
  if (json.parentTaskId === null) {
    json.isComplete = isTaskComplete(task, task.subtasks || [], behavior);
    json.subtaskPercent = subtaskCompletionPercent(task.subtasks || [], behavior);
  }
  return json;
}

async function loadTask(parent, id) {
  const task = await Task.findByPk(id, { include: taskIncludes(parent) });
  return annotate(task, await taskStatusBehaviorMap());
}

async function listTasks(parent) {
  const tasks = await Task.findAll({ where: { ...parent.where, parentTaskId: null }, include: taskIncludes(parent), order: ORDER });
  const behavior = await taskStatusBehaviorMap();
  return tasks.map((t) => annotate(t, behavior));
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

function resolveDueDate(value) {
  if (!given(value)) return null;
  const date = toDateString(value);
  if (!date || String(value).length > 10) throw bad('Invalid due date');
  return date;
}

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
  let parentTask = null;
  if (given(body.parentTaskId)) {
    parentTask = await findTask(parent, body.parentTaskId);
    if (!parentTask) throw bad('Parent task not found');
    if (parentTask.parentTaskId) throw bad("Subtasks can't have subtasks");
  }
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
    dueDate: resolveDueDate(body.dueDate),
    estimateMinutes: resolveEstimate(body.estimateMinutes),
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
  return loadTask(parent, task.id);
}

const sameDate = (a, b) => (a || null) === (b || null);

async function updateTask(req, parent, task, body = {}) {
  const label = task.parentTaskId ? 'Subtask' : 'Task';
  const changes = {};
  if (body.title !== undefined) changes.title = cleanTitle(body.title, label);
  if (body.description !== undefined) changes.description = cleanText(body.description);
  if (body.priority !== undefined) changes.priority = resolvePriority(body.priority);
  if (body.dueDate !== undefined) changes.dueDate = resolveDueDate(body.dueDate);
  if (body.estimateMinutes !== undefined) changes.estimateMinutes = resolveEstimate(body.estimateMinutes);
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
    const same = key === 'dueDate' ? sameDate(changes[key], task.dueDate) : changes[key] === task[key];
    if (same && key !== 'completedAt') delete changes[key];
  }
  if (changes.statusId === undefined) delete changes.completedAt;
  // A status change that stays on the same side (To do -> In progress) is an
  // ordinary edit; crossing into or out of closed has its own event.
  const fields = Object.keys(changes).filter((k) => k !== 'completedAt' && !(k === 'statusId' && statusEvent));
  if (!Object.keys(changes).length) return loadTask(parent, task.id);

  await task.update(changes);
  if (statusEvent) await recordTaskEvent(req, parent, task, statusEvent);
  if (fields.length) {
    await recordTaskEvent(req, parent, task, 'updated', { from: null, to: fields.join(', '), detail: { fields } });
  }
  await audit(req, parent, 'update', task, { fields: Object.keys(changes) });
  return loadTask(parent, task.id);
}

// The task and its subtasks go; their time, expenses, materials, files and
// running timers stay, on no task (the work happened).
async function deleteTask(req, parent, task) {
  await sequelize.transaction(async (transaction) => {
    const subtasks = await Task.findAll({ where: { parentTaskId: task.id }, attributes: ['id'], transaction });
    const ids = [task.id, ...subtasks.map((s) => s.id)];
    const unlink = [TimeEntry, ActiveTimer, ...(parent.kind === 'project' ? [ProjectExpense, ProjectMaterial, ProjectFile] : [])];
    for (const Model of unlink) {
      await Model.update({ taskId: null }, { where: { taskId: ids }, transaction }); // eslint-disable-line no-await-in-loop
    }
    await Task.destroy({ where: { id: ids }, transaction });
  });
  await recordTaskEvent(req, parent, task, 'deleted');
  await audit(req, parent, 'delete', task, { title: task.title, code: task.code });
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
  if (newCode === task.code) return loadTask(parent, task.id);
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
  return loadTask(parent, task.id);
}

module.exports = {
  ticketParent, projectParent, findTask, listTasks, loadTask,
  createTask, updateTask, deleteTask, reorderTasks, renumberTask,
};
