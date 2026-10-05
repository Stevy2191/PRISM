// Ticket CSAT: read and staff-entered submission.
const { Ticket, CsatResponse, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const { canAccessTicket } = require('../../services/permissionService');
const { userAttrs } = require('./shared');

// ---- CSAT (customer happiness) ----

// GET /tickets/:id/csat
const getCsat = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  const csat = await CsatResponse.findOne({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  res.json({ csat });
});

// POST /tickets/:id/csat — records the contact's satisfaction rating.
// Contacts have no PRISM login (until the customer portal exists), so staff
// enter this on their behalf — e.g. from a phone call or a reply-by-email.
// Available once the ticket is resolved or closed.
const submitCsat = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const buckets = await getTicketStatusBuckets();
  if (!buckets.closed.includes(ticket.status)) {
    throw new ApiError(400, 'You can rate a ticket once it is resolved or closed', 'NOT_RATEABLE');
  }

  const { rating, comment } = req.body || {};
  if (!['happy', 'neutral', 'unhappy'].includes(rating)) {
    throw new ApiError(400, 'rating must be happy, neutral, or unhappy', 'VALIDATION_ERROR');
  }

  await CsatResponse.upsert({
    ticketId: ticket.id,
    userId: req.user.id,
    rating,
    comment: comment || null,
    respondedAt: new Date(),
  });
  const csat = await CsatResponse.findOne({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  await writeAudit(req, 'csat.submit', 'CsatResponse', ticket.id, { rating });
  res.status(201).json({ csat });
});

module.exports = {
  getCsat,
  submitCsat,
};
