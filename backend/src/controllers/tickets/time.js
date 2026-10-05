// Ticket time entries: list, log, delete.
const { Ticket, TimeEntry, User, sequelize } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../../services/ticketActivity');
const { calculateLaborCost } = require('../../utils/laborCost');
const { parsePagination, paginated } = require('../../utils/pagination');
const { hasPermission, canAccessTicket } = require('../../services/permissionService');
const { userAttrs, canLogForOthers, SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

// ---- Time entries ----

// GET /tickets/:id/time
const listTime = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await TimeEntry.findAndCountAll({
    where: { ticketId: ticket.id },
    include: [
      { model: User, as: 'user', attributes: userAttrs },
      { model: User, as: 'loggedBy', attributes: userAttrs },
    ],
    order: [['loggedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  // totalMinutes is the ticket's whole logged time, not this page's — it's a
  // headline figure, and summing only the visible rows would quietly
  // under-report it.
  const [{ total: summed } = {}] = await TimeEntry.findAll({
    where: { ticketId: ticket.id },
    attributes: [[sequelize.fn('SUM', sequelize.col('minutes')), 'total']],
    raw: true,
  });
  res.json({
    ...paginated('entries', { rows, count }, { page, limit }),
    totalMinutes: Number(summed) || 0,
  });
});

// POST /tickets/:id/time — Admin/Technician (enforced at route level)
const createTime = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { minutes, note, entryDate, userId, startTime, endTime } = req.body || {};

  // Preferred path: explicit start/end timestamps, from which duration is
  // derived server-side (never trust a client-computed duration). Falls back
  // to a raw minutes value for callers that don't have start/end (e.g. older
  // clients, or a future non-ticket-detail caller).
  let mins;
  let durationSeconds;
  let startDt = null;
  let endDt = null;
  if (startTime && endTime) {
    startDt = new Date(startTime);
    endDt = new Date(endTime);
    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
      throw new ApiError(400, 'Invalid start/end time', 'VALIDATION_ERROR');
    }
    durationSeconds = Math.round((endDt.getTime() - startDt.getTime()) / 1000);
    if (durationSeconds <= 0) {
      throw new ApiError(400, 'End time must be after start time', 'VALIDATION_ERROR');
    }
    mins = Math.max(1, Math.round(durationSeconds / 60));
  } else {
    mins = parseInt(minutes, 10);
    if (!mins || mins < 1) {
      throw new ApiError(400, 'minutes must be a positive integer', 'VALIDATION_ERROR');
    }
    durationSeconds = mins * 60;
  }

  // Attribute the entry to another tech — admins/team leads only.
  let targetUserId = req.user.id;
  let targetUser = req.user;
  if (userId !== undefined && userId !== null && Number(userId) !== req.user.id) {
    if (!(await canLogForOthers(req.user))) {
      throw new ApiError(403, 'Only admins and team leads can log time for other users', 'FORBIDDEN');
    }
    targetUser = await User.findByPk(userId);
    if (!targetUser || !(await hasPermission(targetUser.id, 'projects.log_time'))) {
      throw new ApiError(400, 'Invalid user to log time for', 'VALIDATION_ERROR');
    }
    targetUserId = targetUser.id;
  }

  // The work date is user-editable but never in the future.
  const todayStr = new Date().toISOString().slice(0, 10);
  let resolvedEntryDate = todayStr;
  if (entryDate) {
    const d = String(entryDate).slice(0, 10);
    if (d > todayStr) {
      throw new ApiError(400, 'Entry date cannot be in the future', 'VALIDATION_ERROR');
    }
    resolvedEntryDate = d;
  }

  const entry = await TimeEntry.create({
    ticketId: ticket.id,
    userId: targetUserId,
    loggedById: req.user.id,
    minutes: mins,
    durationSeconds,
    startTime: startDt,
    endTime: endDt,
    note: note || null,
    entryDate: resolvedEntryDate,
    loggedAt: new Date(),
    laborCost: calculateLaborCost(targetUser, { durationSeconds }),
  });
  await writeAudit(req, 'time.create', 'TimeEntry', entry.id, { ticketId: ticket.id, minutes: mins });
  await logActivity(ticket.id, req.user.id, 'time_logged', null, `${mins}m`);

  const fresh = await TimeEntry.findByPk(entry.id, {
    include: [
      { model: User, as: 'user', attributes: userAttrs },
      { model: User, as: 'loggedBy', attributes: userAttrs },
    ],
  });
  res.status(201).json({ entry: fresh });
});

// DELETE /tickets/:id/time/:entryId — owner or admin
const removeTime = asyncHandler(async (req, res) => {
  const entry = await TimeEntry.findOne({
    where: { id: req.params.entryId, ticketId: req.params.id },
  });
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket || !(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only remove your own time entries', 'FORBIDDEN');
  }
  await entry.destroy();
  await writeAudit(req, 'time.delete', 'TimeEntry', entry.id, { ticketId: req.params.id });
  res.json({ ok: true });
});

module.exports = {
  listTime,
  createTime,
  removeTime,
};
