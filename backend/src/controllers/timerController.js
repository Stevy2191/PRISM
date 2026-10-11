// The running timer: one per user, on a ticket or a project, optionally on
// one of its tasks. Stopping or switching writes the elapsed time to the
// ledger through services/time.
const { ActiveTimer, Ticket, Project, Task } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { canAccessTicket, canAccessProject, parseRecordId } = require('../services/permissionService');
const { ticketParent, projectParent } = require('../services/tasks');
const time = require('../services/time');

// A timer logs your own time, which needs time.log (the route) and view
// access to the ticket or project (user decision 2026-10-06).
const KINDS = {
  ticket: { Model: Ticket, toParent: ticketParent, canAccess: canAccessTicket, label: 'Ticket' },
  project: { Model: Project, toParent: projectParent, canAccess: canAccessProject, label: 'Project' },
};
const kindOf = (type) => (Object.hasOwn(KINDS, type) ? KINDS[type] : null); // never Object.prototype's keys
const DISCARDED = {
  gone: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
  denied: 'You no longer have access to what this timer was running on, so its time was discarded.',
};

// Seconds the timer has run: finished stretches plus the current one.
function elapsedOf(t, now = Date.now()) {
  const running = t.runningSince ? Math.max(0, Math.floor((now - new Date(t.runningSince).getTime()) / 1000)) : 0;
  return (t.accumulatedSeconds || 0) + running;
}

function shape(t) {
  return t ? {
    type: t.entityType, id: t.entityId, taskId: t.taskId ?? null, label: t.label, startedAt: t.startedAt,
    state: t.runningSince ? 'running' : 'paused', elapsedSeconds: elapsedOf(t),
  } : null;
}

// Writes the running timer to the ledger. A parent that was deleted, or that
// the user can no longer open, can't take the time: it's discarded, with the
// reason (Q34).
async function logTimer(req, timer, note) {
  const kind = kindOf(timer.entityType);
  const record = kind && await kind.Model.findByPk(timer.entityId);
  if (!record) return { entry: null, discarded: DISCARDED.gone };
  if (!(await kind.canAccess(req.user, record))) {
    return { entry: null, discarded: DISCARDED.denied };
  }
  // The time it ran, ending now: a paused stretch isn't work (plan 3c).
  const endedAt = new Date();
  const entry = await time.logTimerEntry(req, kind.toParent(record), {
    startedAt: new Date(endedAt.getTime() - elapsedOf(timer, endedAt.getTime()) * 1000), endedAt, taskId: timer.taskId, note,
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
      // Starting the same timer again resumes it if it was paused.
      if (!existing.runningSince) await existing.update({ runningSince: new Date() });
      return res.json({ timer: shape(existing), logged: null });
    }
    ({ entry: logged, discarded } = await logTimer(req, existing));
    await existing.destroy();
  }

  const created = await ActiveTimer.create({
    userId: req.user.id, entityType: type, entityId: targetId, taskId, label: label || null, startedAt: new Date(), runningSince: new Date(),
  });
  // A replaced timer that couldn't be logged says why (Q34).
  res.status(201).json({ timer: shape(created), logged, ...(discarded ? { discarded } : {}) });
});

// POST /timer/stop { note? } — logs and clears the running timer.
const stop = asyncHandler(async (req, res) => {
  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  if (!existing) return res.json({ timer: null, entry: null });
  if (req.body?.discard === true) {
    await existing.destroy();
    return res.json({ timer: null, entry: null, discarded: true });
  }
  const { entry, discarded } = await logTimer(req, existing, req.body?.note);
  await existing.destroy();
  res.json(discarded ? { timer: null, entry: null, discarded: true, message: discarded } : { timer: null, entry });
});

// DELETE /timer — discards the running timer without logging.
const cancel = asyncHandler(async (req, res) => {
  await ActiveTimer.destroy({ where: { userId: req.user.id } });
  res.json({ ok: true, timer: null });
});

const mine = (req) => ActiveTimer.findOne({ where: { userId: req.user.id } });
const noTimer = () => new ApiError(404, 'No timer is running', 'NOT_FOUND');

// POST /timer/pause
const pause = asyncHandler(async (req, res) => {
  const t = await mine(req);
  if (!t) throw noTimer();
  if (t.runningSince) await t.update({ accumulatedSeconds: elapsedOf(t), runningSince: null });
  res.json({ timer: shape(t) });
});

// POST /timer/resume
const resume = asyncHandler(async (req, res) => {
  const t = await mine(req);
  if (!t) throw noTimer();
  if (!t.runningSince) await t.update({ runningSince: new Date() });
  res.json({ timer: shape(t) });
});

module.exports = {
  get, start, stop, cancel, pause, resume,
};
