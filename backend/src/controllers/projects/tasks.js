// Project tasks and subtasks: thin wrappers over services/tasks. The
// /tasks/:taskId/subtasks URLs are aliases kept for one release; a subtask
// is also reachable as /tasks/:subtaskId.
const { Project } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessProject } = require('../../services/permissionService');
const tasks = require('../../services/tasks');
const helpers = require('../../services/projects/helpers');
const { assertCanEditProject } = require('./shared');

// Reading needs view access; changing tasks needs the edit tier (Q26).
async function projectFor(req, { edit = true } = {}) {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  if (edit) await assertCanEditProject(req.user, project);
  return tasks.projectParent(project);
}

async function taskFor(parent, rawId) {
  const task = await tasks.findTask(parent, rawId);
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  return task;
}

// The alias URLs name the task and its subtask; both must line up.
async function subtaskFor(parent, req) {
  const task = await taskFor(parent, req.params.taskId);
  const subtask = await tasks.findTask(parent, req.params.subtaskId);
  if (!subtask || subtask.parentTaskId !== task.id) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  return subtask;
}

// GET /projects/:id/tasks — top-level tasks with their subtasks
const listTasks = asyncHandler(async (req, res) => {
  res.json({ tasks: await tasks.listTasks(await projectFor(req, { edit: false }), req.user, { mine: req.query.mine }) });
});

// POST /projects/:id/tasks — { title, description?, statusId?, priority?, assigneeId?, dueDate?, estimateMinutes?, parentTaskId?, linkedTicketId? }
const createTask = asyncHandler(async (req, res) => {
  res.status(201).json({ task: await tasks.createTask(req, await projectFor(req), req.body) });
});

// PATCH /projects/:id/tasks/:taskId
const updateTask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  const { shiftOffer, ...task } = await tasks.updateTask(req, parent, await taskFor(parent, req.params.taskId), req.body);
  res.json({ task, ...(shiftOffer ? { shiftOffer } : {}) });
});

// DELETE /projects/:id/tasks/:taskId
const removeTask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  await tasks.deleteTask(req, parent, await taskFor(parent, req.params.taskId));
  res.json({ ok: true });
});

// PATCH /projects/:id/tasks/reorder — { order: [taskId, ...], parentTaskId? }
const reorderTasks = asyncHandler(async (req, res) => {
  await tasks.reorderTasks(req, await projectFor(req), req.body);
  res.json({ ok: true });
});

// PATCH /projects/:id/tasks/:taskId/code — { number }
const renumberTask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ task: await tasks.renumberTask(req, parent, await taskFor(parent, req.params.taskId), req.body?.number) });
});

// ---- Subtask aliases (one release) ----

const createSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  const task = await taskFor(parent, req.params.taskId);
  if (task.parentTaskId) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  res.status(201).json({ subtask: await tasks.createTask(req, parent, { ...req.body, parentTaskId: task.id }) });
});

const updateSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ subtask: await tasks.updateTask(req, parent, await subtaskFor(parent, req), req.body) });
});

const renumberSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ subtask: await tasks.renumberTask(req, parent, await subtaskFor(parent, req), req.body?.number) });
});

const removeSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  await tasks.deleteTask(req, parent, await subtaskFor(parent, req));
  res.json({ ok: true });
});

// ---- Helpers (decision 15) ----

// POST/DELETE .../helpers — the task id is checked first (404), then the
// service checks who may add or remove.
const addHelper = asyncHandler(async (req, res) => {
  const parent = await projectFor(req, { edit: false });
  const task = await taskFor(parent, req.params.taskId);
  res.status(201).json({ task: await helpers.addHelper(req, parent, task, req.body?.userId) });
});

const removeHelper = asyncHandler(async (req, res) => {
  const parent = await projectFor(req, { edit: false });
  const task = await taskFor(parent, req.params.taskId);
  res.json({ task: await helpers.removeHelper(req, parent, task, req.params.userId) });
});

const addSubtaskHelper = asyncHandler(async (req, res) => {
  const parent = await projectFor(req, { edit: false });
  res.status(201).json({ task: await helpers.addHelper(req, parent, await subtaskFor(parent, req), req.body?.userId) });
});

const removeSubtaskHelper = asyncHandler(async (req, res) => {
  const parent = await projectFor(req, { edit: false });
  res.json({ task: await helpers.removeHelper(req, parent, await subtaskFor(parent, req), req.params.userId) });
});

module.exports = {
  addHelper,
  removeHelper,
  addSubtaskHelper,
  removeSubtaskHelper,
  listTasks,
  createTask,
  updateTask,
  removeTask,
  reorderTasks,
  renumberTask,
  createSubtask,
  updateSubtask,
  removeSubtask,
  renumberSubtask,
};
