// Ticket tasks (checklist): list, add, update.
const { Ticket, TicketTask, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { assertCanWorkTicket } = require('../../services/ticketPeople');
const { canAccessTicket } = require('../../services/permissionService');
const { userAttrs } = require('./shared');

// ---- Tasks (per-ticket checklist) ----

// GET /tickets/:id/tasks
const listTasks = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const tasks = await TicketTask.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    order: [['createdAt', 'ASC']],
  });
  res.json({ tasks });
});

// POST /tickets/:id/tasks { description, assigneeId? }
const createTask = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { description, assigneeId } = req.body || {};
  if (!description || !description.trim()) {
    throw new ApiError(400, 'Task description is required', 'VALIDATION_ERROR');
  }
  const task = await TicketTask.create({
    ticketId: ticket.id,
    description: description.trim(),
    assigneeId: assigneeId ? await assertCanWorkTicket(assigneeId, ticket.companyId, 'Assignee') : null,
  });
  const fresh = await TicketTask.findByPk(task.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
  });
  res.status(201).json({ task: fresh });
});

// PATCH /tickets/:id/tasks/:taskId { completed?, assigneeId?, description? }
const updateTask = asyncHandler(async (req, res) => {
  const task = await TicketTask.findOne({ where: { id: req.params.taskId, ticketId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket || !(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }

  const changes = {};
  if (req.body?.completed !== undefined) changes.completed = !!req.body.completed;
  if (req.body?.assigneeId !== undefined) {
    changes.assigneeId = req.body.assigneeId && Number(req.body.assigneeId) !== task.assigneeId
      ? await assertCanWorkTicket(req.body.assigneeId, ticket.companyId, 'Assignee')
      : (req.body.assigneeId || null);
  }
  if (req.body?.description !== undefined && req.body.description.trim()) {
    changes.description = req.body.description.trim();
  }
  await task.update(changes);

  const fresh = await TicketTask.findByPk(task.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
  });
  res.json({ task: fresh });
});

module.exports = {
  listTasks,
  createTask,
  updateTask,
};
