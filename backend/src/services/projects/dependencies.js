// Finish-to-start dependencies between a project's top-level tasks and
// milestones (sub-project 6). A task is waiting while any predecessor is not
// done; that is derived from the predecessors' statuses, never stored, and it
// never blocks work (a waiting task can still be started, logged and closed).
const { Op } = require('sequelize');
const {
  Task, TaskDependency, TaskAssignee, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId } = require('../permissionService');
const { createNotification } = require('../notifications');
const { taskStatusBehaviorMap } = require('../tasks/statuses');
const {
  waitingOn, wouldCycle, downstream, shiftTasks, daysBetween,
} = require('./schedule');

const TASK_ATTRS = ['id', 'code', 'title', 'startDate', 'dueDate', 'statusId'];
const bad = (message, code = 'VALIDATION_ERROR') => new ApiError(400, message, code);
const isDone = (behavior, task) => behavior.get(task.statusId) === 'closed';
const plainLink = (d) => ({ id: d.id, predecessorId: d.predecessorId, successorId: d.successorId });

// The project's top-level tasks by id, and its links (both ends are top-level
// tasks of the project, so the links are those leaving one of them).
async function loadGraph(projectId) {
  const tasks = await Task.findAll({ where: { projectId, parentTaskId: null }, attributes: TASK_ATTRS });
  const deps = tasks.length
    ? await TaskDependency.findAll({ where: { predecessorId: tasks.map((t) => t.id) }, order: [['id', 'ASC']] })
    : [];
  return { tasks: new Map(tasks.map((t) => [t.id, t])), deps };
}

// { waitingOn, holdingUp } for one top-level task, from a loaded graph.
function linksFor(taskId, graph, behavior) {
  const doneIds = new Set([...graph.tasks.values()].filter((t) => isDone(behavior, t)).map((t) => t.id));
  const shown = (id) => graph.tasks.get(id);
  return {
    waitingOn: waitingOn(taskId, graph.deps, doneIds).map(shown).filter(Boolean)
      .map((t) => ({ id: t.id, code: t.code, title: t.title, dueDate: t.dueDate || null })),
    holdingUp: graph.deps.filter((d) => d.predecessorId === taskId).map((d) => shown(d.successorId)).filter(Boolean)
      .map((t) => ({ id: t.id, code: t.code, title: t.title })),
  };
}

async function listLinks(project) {
  const { deps } = await loadGraph(project.id);
  return deps.map(plainLink);
}

// Both tasks must be top-level tasks of this project, else DEPENDENCY_SCOPE
// (a task of another project looks the same as a missing one).
async function createLink(req, project, body = {}) {
  const predecessorId = parseRecordId(body.predecessorId);
  const successorId = parseRecordId(body.successorId);
  if (!predecessorId || !successorId) throw bad('predecessorId and successorId are required');
  const found = await Task.findAll({
    where: { id: [predecessorId, successorId], projectId: project.id, parentTaskId: null }, attributes: ['id'],
  });
  if (found.length !== new Set([predecessorId, successorId]).size) {
    throw bad('A dependency links two tasks or milestones of this project', 'DEPENDENCY_SCOPE');
  }
  const { deps } = await loadGraph(project.id);
  if (deps.some((d) => d.predecessorId === predecessorId && d.successorId === successorId)) {
    throw new ApiError(409, 'Those tasks are already linked', 'DEPENDENCY_EXISTS');
  }
  if (wouldCycle(deps, predecessorId, successorId)) throw bad("A task can't wait on itself, directly or through other tasks", 'DEPENDENCY_CYCLE');
  let link;
  try {
    link = await TaskDependency.create({ predecessorId, successorId, createdBy: req.user.id });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw new ApiError(409, 'Those tasks are already linked', 'DEPENDENCY_EXISTS');
    throw err;
  }
  await writeAudit(req, 'taskDependency.create', 'TaskDependency', link.id, { projectId: project.id, predecessorId, successorId });
  return plainLink(link);
}

// The link must belong to this project, else 404.
async function removeLink(req, project, rawId) {
  const id = parseRecordId(rawId);
  const link = id && await TaskDependency.findOne({
    where: { id },
    include: [{ model: Task, as: 'predecessor', attributes: ['id'], where: { projectId: project.id }, required: true }],
  });
  if (!link) throw new ApiError(404, 'Dependency not found', 'NOT_FOUND');
  await link.destroy();
  await writeAudit(req, 'taskDependency.delete', 'TaskDependency', link.id, {
    projectId: project.id, predecessorId: link.predecessorId, successorId: link.successorId,
  });
}

// After a due date moved later: the unfinished tasks downstream, to offer to
// move by the same number of days (only those with dates: shiftDependents
// has nothing to move on an undated task). null when there is nothing to offer.
async function shiftOffer(project, task, oldDue, newDue) {
  if (task.parentTaskId || !oldDue || !newDue || newDue <= oldDue) return null;
  const graph = await loadGraph(project.id);
  const behavior = await taskStatusBehaviorMap();
  const open = downstream(graph.deps, task.id).map((id) => graph.tasks.get(id)).filter((t) => t && !isDone(behavior, t) && (t.startDate || t.dueDate));
  if (!open.length) return null;
  return { days: daysBetween(oldDue, newDue), tasks: open.map((t) => ({ id: t.id, code: t.code, title: t.title })) };
}

// Moves everything downstream of a task by `days`, in one transaction.
// Finished tasks stay where they are; a task with no dates has nothing to move.
async function shiftDependents(req, project, task, rawDays) {
  const days = Number(rawDays);
  if (typeof rawDays === 'boolean' || !Number.isInteger(days) || days < 1 || days > 365) throw bad('days must be a whole number from 1 to 365');
  const graph = await loadGraph(project.id);
  const behavior = await taskStatusBehaviorMap();
  const chain = downstream(graph.deps, task.id).map((id) => graph.tasks.get(id))
    .filter((t) => t && !isDone(behavior, t) && (t.startDate || t.dueDate));
  const moved = shiftTasks(chain, chain.map((t) => t.id), days);
  await sequelize.transaction(async (transaction) => {
    for (const m of moved) {
      await Task.update({ startDate: m.startDate, dueDate: m.dueDate }, { where: { id: m.id }, transaction }); // eslint-disable-line no-await-in-loop
    }
  });
  await writeAudit(req, 'task.shiftDependents', 'Task', task.id, { projectId: project.id, days, moved: moved.map((m) => m.id) });
  return moved;
}

// A task was finished: whoever was waiting on it (the assignee and helpers of
// each task it was holding up) hears about it once all of that task's
// predecessors are done. Never the person who finished it, and createNotification
// drops anyone who can no longer reach the project.
async function notifyUnblocked(task, actorId) {
  if (task.parentTaskId || !task.projectId) return;
  const links = await TaskDependency.findAll({ where: { predecessorId: task.id } });
  if (!links.length) return;
  const { peopleOn } = require('./helpers'); // eslint-disable-line global-require
  const behavior = await taskStatusBehaviorMap();
  for (const link of links) {
    const successor = await Task.findByPk(link.successorId); // eslint-disable-line no-await-in-loop
    if (!successor || isDone(behavior, successor)) continue; // eslint-disable-line no-continue, no-await-in-loop
    const predLinks = await TaskDependency.findAll({ where: { successorId: successor.id }, attributes: ['predecessorId'] }); // eslint-disable-line no-await-in-loop
    const preds = await Task.findAll({ where: { id: { [Op.in]: predLinks.map((l) => l.predecessorId) } }, attributes: ['id', 'statusId'] }); // eslint-disable-line no-await-in-loop
    if (preds.some((p) => !isDone(behavior, p))) continue; // eslint-disable-line no-continue
    const helpers = await TaskAssignee.findAll({ where: { taskId: successor.id }, attributes: ['userId'] }); // eslint-disable-line no-await-in-loop
    const people = peopleOn({ assigneeId: successor.assigneeId, helpers: helpers.map((h) => h.userId) }).filter((id) => id !== actorId);
    for (const userId of people) {
      await createNotification({ // eslint-disable-line no-await-in-loop
        userId,
        type: 'task_unblocked',
        message: `${successor.code} ${successor.title} is ready to start: ${task.code} ${task.title} is finished`,
        projectId: successor.projectId,
      });
    }
  }
}

module.exports = {
  loadGraph, linksFor, listLinks, createLink, removeLink, shiftOffer, shiftDependents, notifyUnblocked,
};
