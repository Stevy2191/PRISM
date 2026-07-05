// Ticket-only — project time logging now goes through the dedicated
// Time Entries tab (POST /projects/:id/time-entries), which supports task
// links and logging-for-another-user; this single-active-timer system
// predates that and no longer has a project-side counterpart.
const { ActiveTimer, TimeEntry, Ticket } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { logActivity } = require('../services/ticketActivity');

function shape(t) {
  return t ? { type: t.entityType, id: t.entityId, label: t.label, startedAt: t.startedAt } : null;
}

// Convert a running timer into a TimeEntry (logged against its start time).
async function logTimer(req, timer, note) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000));
  const minutes = Math.max(1, Math.round(seconds / 60));
  const entry = await TimeEntry.create({
    userId: req.user.id,
    minutes,
    note: note || 'Timer',
    loggedAt: timer.startedAt,
    ticketId: timer.entityId,
  });
  await writeAudit(req, 'timer.log', 'TimeEntry', entry.id, { ticketId: timer.entityId, minutes });
  await logActivity(timer.entityId, req.user.id, 'time_logged', null, `${minutes}m`);
  return entry;
}

// GET /timer — the current user's running timer (or null).
const get = asyncHandler(async (req, res) => {
  const t = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  res.json({ timer: shape(t) });
});

// POST /timer/start { type, id, label }
// Starting while another timer runs logs that one first.
const start = asyncHandler(async (req, res) => {
  const { type, id, label } = req.body || {};
  if (type !== 'ticket') {
    throw new ApiError(400, 'Invalid timer type', 'VALIDATION_ERROR');
  }
  const targetId = parseInt(id, 10);
  if (!targetId) throw new ApiError(400, 'A target id is required', 'VALIDATION_ERROR');
  if (!(await Ticket.findByPk(targetId))) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  let logged = null;
  if (existing) {
    if (existing.entityType === type && existing.entityId === targetId) {
      return res.json({ timer: shape(existing), logged: null });
    }
    logged = await logTimer(req, existing);
    await existing.destroy();
  }

  const created = await ActiveTimer.create({
    userId: req.user.id,
    entityType: type,
    entityId: targetId,
    label: label || null,
    startedAt: new Date(),
  });
  res.status(201).json({ timer: shape(created), logged });
});

// POST /timer/stop { note? } — logs and clears the running timer.
const stop = asyncHandler(async (req, res) => {
  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  if (!existing) return res.json({ timer: null, entry: null });
  const entry = await logTimer(req, existing, req.body?.note);
  await existing.destroy();
  res.json({ timer: null, entry });
});

// DELETE /timer — discards the running timer without logging.
const cancel = asyncHandler(async (req, res) => {
  await ActiveTimer.destroy({ where: { userId: req.user.id } });
  res.json({ ok: true, timer: null });
});

module.exports = { get, start, stop, cancel };
