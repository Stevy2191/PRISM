const { ActiveTimer, TimeEntry, Ticket, Project } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

function shape(t) {
  return t ? { type: t.entityType, id: t.entityId, label: t.label, startedAt: t.startedAt } : null;
}

// Convert a running timer into a TimeEntry (logged against its start time).
async function logTimer(req, timer) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000));
  const minutes = Math.max(1, Math.round(seconds / 60));
  const base = { userId: req.user.id, minutes, note: 'Timer', loggedAt: timer.startedAt };
  const entry = await TimeEntry.create(
    timer.entityType === 'project'
      ? { ...base, projectId: timer.entityId }
      : { ...base, ticketId: timer.entityId }
  );
  await writeAudit(req, 'timer.log', 'TimeEntry', entry.id, {
    [`${timer.entityType}Id`]: timer.entityId,
    minutes,
  });
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
  if (!['ticket', 'project'].includes(type)) {
    throw new ApiError(400, 'Invalid timer type', 'VALIDATION_ERROR');
  }
  const targetId = parseInt(id, 10);
  if (!targetId) throw new ApiError(400, 'A target id is required', 'VALIDATION_ERROR');

  if (type === 'ticket') {
    if (!(await Ticket.findByPk(targetId))) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  } else if (!(await Project.findByPk(targetId))) {
    throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  }

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

// POST /timer/stop — logs and clears the running timer.
const stop = asyncHandler(async (req, res) => {
  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  if (!existing) return res.json({ timer: null, entry: null });
  const entry = await logTimer(req, existing);
  await existing.destroy();
  res.json({ timer: null, entry });
});

// DELETE /timer — discards the running timer without logging.
const cancel = asyncHandler(async (req, res) => {
  await ActiveTimer.destroy({ where: { userId: req.user.id } });
  res.json({ ok: true, timer: null });
});

module.exports = { get, start, stop, cancel };
