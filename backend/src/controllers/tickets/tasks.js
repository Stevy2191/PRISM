// Ticket tasks: thin wrappers over services/tasks (the same rules as
// project tasks — statuses, subtasks, codes, reorder, renumber).
const { Ticket } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessTicket } = require('../../services/permissionService');
const tasks = require('../../services/tasks');

async function ticketFor(req) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  return tasks.ticketParent(ticket);
}

async function taskFor(parent, rawId) {
  const task = await tasks.findTask(parent, rawId);
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  return task;
}

// GET /tickets/:id/tasks — top-level tasks with their subtasks
const listTasks = asyncHandler(async (req, res) => {
  res.json({ tasks: await tasks.listTasks(await ticketFor(req)) });
});

// POST /tickets/:id/tasks — { title, description?, statusId?, priority?, assigneeId?, dueDate?, estimateMinutes?, parentTaskId? }
const createTask = asyncHandler(async (req, res) => {
  res.status(201).json({ task: await tasks.createTask(req, await ticketFor(req), req.body) });
});

// PATCH /tickets/:id/tasks/:taskId
const updateTask = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  res.json({ task: await tasks.updateTask(req, parent, await taskFor(parent, req.params.taskId), req.body) });
});

// DELETE /tickets/:id/tasks/:taskId
const removeTask = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  await tasks.deleteTask(req, parent, await taskFor(parent, req.params.taskId));
  res.json({ ok: true });
});

// PATCH /tickets/:id/tasks/reorder — { order: [taskId, ...], parentTaskId? }
const reorderTasks = asyncHandler(async (req, res) => {
  await tasks.reorderTasks(req, await ticketFor(req), req.body);
  res.json({ ok: true });
});

// PATCH /tickets/:id/tasks/:taskId/code — { number }
const renumberTask = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  res.json({ task: await tasks.renumberTask(req, parent, await taskFor(parent, req.params.taskId), req.body?.number) });
});

module.exports = {
  listTasks,
  createTask,
  updateTask,
  removeTask,
  reorderTasks,
  renumberTask,
};
