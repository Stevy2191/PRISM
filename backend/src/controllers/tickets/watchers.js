// Ticket watchers: list, add, remove. A watcher is a staff user or (client
// portal) a contact; contact watchers need portal.manage on top of the
// route's tickets.manage_watchers, since they open the ticket to the portal.
const {
  Ticket, TicketWatcher, User, Contact,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { addTicketWatcher, addContactWatcher } = require('../../services/tickets/ticketWrite');
const { canAccessTicket, hasPermission, parseRecordId } = require('../../services/permissionService');
const { displayName } = require('../portal/authController');
const { userAttrs } = require('./shared');

const watcherInclude = [
  { model: User, as: 'user', attributes: userAttrs },
  { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'displayName', 'email', 'portalAccess'] },
];

function watcherJson(w) {
  const base = { id: w.id, ticketId: w.ticketId, createdAt: w.createdAt };
  if (w.contactId != null) {
    return {
      ...base,
      kind: 'contact',
      contact: w.contact ? {
        id: w.contact.id, displayName: displayName(w.contact), email: w.contact.email, portalAccess: w.contact.portalAccess,
      } : { id: w.contactId },
    };
  }
  return {
    ...base, kind: 'user', userId: w.userId, user: w.user,
  };
}

async function loadTicket(req) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  return ticket;
}

async function assertPortalManage(req) {
  if (!(await hasPermission(req.user.id, 'portal.manage'))) {
    throw new ApiError(403, 'Contact watchers need Manage portal access', 'FORBIDDEN');
  }
}

// GET /tickets/:id/watchers
const listWatchers = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  const watchers = await TicketWatcher.findAll({
    where: { ticketId: ticket.id }, include: watcherInclude, order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  res.json({ watchers: watchers.map(watcherJson) });
});

// POST /tickets/:id/watchers { userId } | { contactId }
const addWatcher = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  const { userId, contactId } = req.body || {};
  if (userId != null && contactId != null) throw new ApiError(400, 'Give a userId or a contactId, not both', 'VALIDATION_ERROR');
  let result;
  if (contactId != null) {
    await assertPortalManage(req);
    result = await addContactWatcher(req, ticket, contactId);
  } else {
    result = await addTicketWatcher(req, ticket, userId);
  }
  const fresh = await TicketWatcher.findByPk(result.watcher.id, { include: watcherInclude });
  res.status(201).json({ watcher: watcherJson(fresh) });
});

// DELETE /tickets/:id/watchers/:userId
const removeWatcher = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  const userId = parseRecordId(req.params.userId);
  const removed = userId ? await TicketWatcher.destroy({ where: { ticketId: ticket.id, userId } }) : 0;
  if (removed) await writeAudit(req, 'watcher.remove', 'Ticket', ticket.id, { userId });
  res.json({ ok: true });
});

// DELETE /tickets/:id/watchers/contacts/:contactId
const removeContactWatcher = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  await assertPortalManage(req);
  const contactId = parseRecordId(req.params.contactId);
  const removed = contactId ? await TicketWatcher.destroy({ where: { ticketId: ticket.id, contactId } }) : 0;
  if (removed) await writeAudit(req, 'watcher.remove', 'Ticket', ticket.id, { contactId });
  res.json({ ok: true });
});

module.exports = {
  listWatchers,
  addWatcher,
  removeWatcher,
  removeContactWatcher,
};
