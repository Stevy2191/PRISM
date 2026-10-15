// Ticket watchers: list, add, remove.
const { Ticket, TicketWatcher, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { addTicketWatcher } = require('../../services/tickets/ticketWrite');
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

  const { watcher } = await addTicketWatcher(req, ticket, req.body?.userId);
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

  const removed = await TicketWatcher.destroy({ where: { ticketId: ticket.id, userId: req.params.userId } });
  if (removed) await writeAudit(req, 'watcher.remove', 'Ticket', ticket.id, { userId: Number(req.params.userId) });
  res.json({ ok: true });
});

module.exports = {
  listWatchers,
  addWatcher,
  removeWatcher,
};
