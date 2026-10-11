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
    timerId: t.id, type: t.entityType, id: t.entityId, taskId: t.taskId ?? null, label: t.label, startedAt: t.startedAt,
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

// Takes the timer row so only one request logs it: two stops at once, or a
// stop racing a start elsewhere, log it once (plan 3c review). False when
// another request got there first.
async function claim(timer) {
  return (await ActiveTimer.destroy({ where: { id: timer.id } })) === 1;
}

// Puts back a claimed timer whose logging failed, so no time is lost.
async function restore(timer) {
  await ActiveTimer.create(timer.get({ plain: true }));
}

// Logs a claimed timer, putting it back if logging throws.
async function logClaimed(req, timer, note) {
  try {
    return await logTimer(req, timer, note);
  } catch (err) {
    await restore(timer);
    throw err;
  }
}

const cleanLabel = (label) => (typeof label === 'string' ? label.trim().slice(0, 255) || null : null);
const changed = () => new ApiError(409, 'This timer was already logged or replaced', 'TIMER_CHANGED');

// GET /timer — the current user's running timer (or null).
const get = asyncHandler(async (req, res) => {
  res.json({ timer: shape(await ActiveTimer.findOne({ where: { userId: req.user.id } })) });
});

// POST /timer/start { type: 'ticket' | 'project', id, taskId?, label?, onlyIfIdle? }
// Starting while another timer runs logs that one first. With onlyIfIdle
// (automatic mode) an existing timer, anywhere, is left exactly as it is.
const start = asyncHandler(async (req, res) => {
  const { type } = req.body || {};
  const onlyIfIdle = req.body?.onlyIfIdle === true;
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
    if (onlyIfIdle) return res.json({ timer: shape(existing), logged: null, started: false });
    if (existing.entityType === type && existing.entityId === targetId && (existing.taskId ?? null) === taskId) {
      // Starting the same timer again resumes it if it was paused.
      if (!existing.runningSince) await existing.update({ runningSince: new Date() });
      return res.json({ timer: shape(existing), logged: null, started: false });
    }
    if (await claim(existing)) ({ entry: logged, discarded } = await logClaimed(req, existing));
  }

  const created = await ActiveTimer.create({
    userId: req.user.id, entityType: type, entityId: targetId, taskId, label: cleanLabel(req.body?.label), startedAt: new Date(), runningSince: new Date(),
  });
  // A replaced timer that couldn't be logged says why (Q34).
  res.status(201).json({ timer: shape(created), logged, started: true, ...(discarded ? { discarded } : {}) });
});

// POST /timer/stop { note?, discard?, entry?, expectTimerId? } — logs and
// clears the running timer.
//   - discard: clears it without logging.
//   - entry: the Log time form's fields (as POST …/time takes them); the
//     timer is logged as that entry instead, in the same call (plan 3c review).
//   - expectTimerId: the timer the caller means (its timerId). If it was
//     already logged or replaced (another tab, another device), nothing
//     happens: 409. A replacement always gets a new id.
const stop = asyncHandler(async (req, res) => {
  const { discard, entry: form, expectTimerId } = req.body || {};
  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  if (expectTimerId !== undefined && (!existing || Number(expectTimerId) !== existing.id)) {
    throw changed();
  }
  if (!existing) return res.json({ timer: null, entry: null });
  if (discard === true) {
    await claim(existing);
    return res.json({ timer: null, entry: null, discarded: true });
  }
  if (form && typeof form === 'object') {
    const kind = kindOf(existing.entityType);
    const record = kind && await kind.Model.findByPk(existing.entityId);
    const reason = !record ? DISCARDED.gone : (!(await kind.canAccess(req.user, record)) ? DISCARDED.denied : null);
    if (!(await claim(existing))) throw changed();
    if (reason) return res.json({ timer: null, entry: null, discarded: true, message: reason });
    try {
      const entry = await time.createEntry(req, kind.toParent(record), form);
      return res.json({ timer: null, entry });
    } catch (err) {
      await restore(existing);
      throw err;
    }
  }
  if (!(await claim(existing))) return res.json({ timer: null, entry: null });
  const { entry, discarded } = await logClaimed(req, existing, req.body?.note);
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
