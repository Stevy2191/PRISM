// The running timer: one per user, on a ticket or a project, optionally on
// one of its tasks. Stopping or switching writes the elapsed time to the
// ledger through services/time.
const { ActiveTimer, Ticket, Project, Task } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const {
  canAccessTicket, canAccessProject, parseRecordId, hasAnyPermission,
} = require('../services/permissionService');
const { ticketParent, projectParent } = require('../services/tasks');
const time = require('../services/time');

// gate: what logging time there needs besides time.log, until plan 3b-2's
// edit tier — the same keys as the ticket and project time routes.
const KINDS = {
  ticket: {
    Model: Ticket, toParent: ticketParent, canAccess: canAccessTicket, label: 'Ticket',
    gate: ['tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all'],
  },
  project: {
    Model: Project, toParent: projectParent, canAccess: canAccessProject, label: 'Project', gate: ['projects.log_time'],
  },
};
const kindOf = (type) => (Object.hasOwn(KINDS, type) ? KINDS[type] : null); // never Object.prototype's keys
const DISCARDED = {
  gone: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
  denied: 'You no longer have access to what this timer was running on, so its time was discarded.',
};

function shape(t) {
  return t ? {
    type: t.entityType, id: t.entityId, taskId: t.taskId ?? null, label: t.label, startedAt: t.startedAt,
  } : null;
}

// Writes the running timer to the ledger. A parent that was deleted, or that
// the user can no longer open, can't take the time: it's discarded, with the
// reason (Q34).
async function logTimer(req, timer, note) {
  const kind = kindOf(timer.entityType);
  const record = kind && await kind.Model.findByPk(timer.entityId);
  if (!record) return { entry: null, discarded: DISCARDED.gone };
  if (!(await kind.canAccess(req.user, record)) || !(await hasAnyPermission(req.user.id, kind.gate))) {
    return { entry: null, discarded: DISCARDED.denied };
  }
  const entry = await time.logTimerEntry(req, kind.toParent(record), {
    startedAt: timer.startedAt, endedAt: new Date(), taskId: timer.taskId, note,
  });
  return { entry, discarded: null };
}

// GET /timer — the current user's running timer (or null).
const get = asyncHandler(async (req, res) => {
  res.json({ timer: shape(await ActiveTimer.findOne({ where: { userId: req.user.id } })) });
});

// POST /timer/start { type: 'ticket' | 'project', id, taskId?, label? }
// Starting while another timer runs logs that one first.
const start = asyncHandler(async (req, res) => {
  const { type, label } = req.body || {};
  const kind = kindOf(type);
  if (!kind) throw new ApiError(400, 'Invalid timer type', 'VALIDATION_ERROR');
  if (!(await hasAnyPermission(req.user.id, kind.gate))) throw new ApiError(403, 'Insufficient permissions', 'FORBIDDEN');
  const targetId = parseRecordId(req.body?.id);
  if (!targetId) throw new ApiError(400, 'A target id is required', 'VALIDATION_ERROR');
  const record = await kind.Model.findByPk(targetId);
  if (!record) throw new ApiError(404, `${kind.label} not found`, 'NOT_FOUND');
  // A timer logs time there when it stops, so starting one needs access to it.
  if (!(await kind.canAccess(req.user, record))) throw new ApiError(403, `You do not have access to this ${type}`, 'FORBIDDEN');

  let taskId = null;
  const rawTask = req.body?.taskId;
  if (rawTask !== undefined && rawTask !== null && rawTask !== '') {
    const id = parseRecordId(rawTask);
    const task = id && await Task.findOne({ where: { id, ...kind.toParent(record).where }, attributes: ['id'] });
    if (!task) throw new ApiError(400, `Task does not belong to this ${type}`, 'VALIDATION_ERROR');
    taskId = task.id;
  }

  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  let logged = null;
  let discarded = null;
  if (existing) {
    if (existing.entityType === type && existing.entityId === targetId && (existing.taskId ?? null) === taskId) {
      return res.json({ timer: shape(existing), logged: null });
    }
    ({ entry: logged, discarded } = await logTimer(req, existing));
    await existing.destroy();
  }

  const created = await ActiveTimer.create({
    userId: req.user.id, entityType: type, entityId: targetId, taskId, label: label || null, startedAt: new Date(),
  });
  // A replaced timer that couldn't be logged says why (Q34).
  res.status(201).json({ timer: shape(created), logged, ...(discarded ? { discarded } : {}) });
});

// POST /timer/stop { note? } — logs and clears the running timer.
const stop = asyncHandler(async (req, res) => {
  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  if (!existing) return res.json({ timer: null, entry: null });
  const { entry, discarded } = await logTimer(req, existing, req.body?.note);
  await existing.destroy();
  res.json(discarded ? { timer: null, entry: null, discarded: true, message: discarded } : { timer: null, entry });
});

// DELETE /timer — discards the running timer without logging.
const cancel = asyncHandler(async (req, res) => {
  await ActiveTimer.destroy({ where: { userId: req.user.id } });
  res.json({ ok: true, timer: null });
});

module.exports = { get, start, stop, cancel };
