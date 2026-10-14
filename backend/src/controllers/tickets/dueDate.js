// POST /tickets/:id/due-date — the only way to move a ticket's SLA due date
// (spec 2026-10-13 change). Later with a reason is an extension anyone who
// can edit the ticket may make; earlier, or without a reason, is an
// adjustment that needs tickets.adjust_sla_due.
const { Ticket, TicketSla, sequelize } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../../services/ticketActivity');
const { changeDueDate: moveDueDate } = require('../../services/sla/ticketSla');
const { orgTimeZone, toDateString, zoneWallTime } = require('../../utils/orgTime');
const { canAccessTicket, hasPermission, parseRecordId } = require('../../services/permissionService');
const { ticketInclude, ticketDetailFor, assertCanEditTicket } = require('./shared');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const REASON_MAX = 1000;
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

const changeDueDate = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(parseRecordId(req.params.id) || 0);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  await assertCanEditTicket(req.user, ticket);

  const { dueDate, dueTime, reason } = req.body || {};
  const date = toDateString(dueDate);
  if (!date || typeof dueDate !== 'string' || dueDate.length !== 10) throw bad('Due date must be a date (YYYY-MM-DD)');
  if (typeof dueTime !== 'string' || !HHMM.test(dueTime)) throw bad('Due time must be HH:MM');
  if (reason !== undefined && reason !== null && typeof reason !== 'string') throw bad('Reason must be text');
  const text = (reason || '').trim();
  if (text.length > REASON_MAX) throw bad(`Reason must be ${REASON_MAX} characters or fewer`);

  const sla = await TicketSla.findOne({ where: { ticketId: ticket.id }, attributes: ['resolutionDueAt'] });
  if (!sla || !sla.resolutionDueAt) throw bad('This ticket has no SLA due date; edit the due date directly');

  const to = zoneWallTime(date, dueTime, await orgTimeZone());
  const current = new Date(sla.resolutionDueAt);
  if (to.getTime() === current.getTime()) throw bad('That is already the due date');
  const kind = to > current && text ? 'extension' : 'adjustment';
  if (kind === 'adjustment' && !(await hasPermission(req.user.id, 'tickets.adjust_sla_due'))) {
    throw new ApiError(403, 'Only someone who can adjust SLA due dates can move a due date earlier or without a reason', 'FORBIDDEN');
  }

  const moved = await sequelize.transaction((transaction) => moveDueDate(ticket.id, {
    toDueAt: to, userId: req.user.id, reason: text || null, kind, transaction,
  }));
  const from = moved.fromDueAt ? new Date(moved.fromDueAt).toISOString() : null;
  await logActivity(ticket.id, req.user.id, kind === 'extension' ? 'due_date_extended' : 'due_date_adjusted', from, to.toISOString());
  await writeAudit(req, 'ticket.dueDate.change', 'Ticket', ticket.id, {
    kind, from, to: to.toISOString(), reason: text || null,
  });

  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.json({ ticket: await ticketDetailFor(req.user, fresh) });
});

module.exports = { changeDueDate };
