// Ticket watchers: list, add, remove.
const { Ticket, TicketWatcher, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { assertCanWorkTicket } = require('../../services/ticketPeople');
const { canAccessTicket } = require('../../services/permissionService');
const { userAttrs } = require('./shared');

// ---- Watchers ----

// GET /tickets/:id/watchers
const listWatchers = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const watchers = await TicketWatcher.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'ASC']],
  });
  res.json({ watchers });
});

// POST /tickets/:id/watchers { userId }
const addWatcher = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  if (!req.body?.userId) throw new ApiError(400, 'userId is required', 'VALIDATION_ERROR');
  const userId = await assertCanWorkTicket(req.body.userId, ticket.companyId, 'Watcher');

  const [watcher] = await TicketWatcher.findOrCreate({
    where: { ticketId: ticket.id, userId },
  });
  const fresh = await TicketWatcher.findByPk(watcher.id, {
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  res.status(201).json({ watcher: fresh });
});

// DELETE /tickets/:id/watchers/:userId
const removeWatcher = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  await TicketWatcher.destroy({ where: { ticketId: ticket.id, userId: req.params.userId } });
  res.json({ ok: true });
});

module.exports = {
  listWatchers,
  addWatcher,
  removeWatcher,
};
