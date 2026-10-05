// Ticket activity feed and the PDF report.
const { Ticket, TicketActivity, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { parsePagination, paginated } = require('../../utils/pagination');
const { generateTicketReport } = require('../../services/ticketReport');
const { canAccessTicket } = require('../../services/permissionService');
const { userAttrs, SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

// ---- Activity (per-ticket timeline) ----

// GET /tickets/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await TicketActivity.findAndCountAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  res.json(paginated('activity', { rows, count }, { page, limit }));
});

// GET /tickets/:id/report — streams a generated PDF report for this ticket.
const generateReport = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id, { attributes: ['id', 'departmentId', 'assigneeId', 'companyId'] });
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  const ok = await generateTicketReport(ticket.id, res);
  if (!ok) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
});

module.exports = {
  listActivity,
  generateReport,
};
