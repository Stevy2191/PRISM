// A user's timers (user decision 2026-10-12): one per ticket or project,
// optionally on one of its tasks. Timers on different items count at the same
// time; on the same item, starting another task's timer logs the current one
// first, so one piece of work isn't counted twice. Stopping writes the elapsed
// time to the ledger through services/time. A timer stops counting at the
// longest-entry limit (Settings → Time Tracking).
const { UniqueConstraintError } = require('sequelize');
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
// Enough for any real day's parallel work; a bound on rows one user can make.
const MAX_TIMERS = 20;

// Seconds the timer has counted: finished stretches plus the current one, up
// to the limit.
function elapsedOf(t, limit, now = Date.now()) {
  const running = t.runningSince ? Math.max(0, Math.floor((now - new Date(t.runningSince).getTime()) / 1000)) : 0;
  return Math.min(limit, (t.accumulatedSeconds || 0) + running);
}

// A running timer that reached the limit is paused there, so it reads the
// same everywhere from now on.
async function settle(t, limit) {
  if (t.runningSince && elapsedOf(t, limit) >= limit) {
    await t.update({ accumulatedSeconds: limit, runningSince: null });
  }
  return t;
}

function shape(t, limit) {
  if (!t) return null;
  const elapsedSeconds = elapsedOf(t, limit);
  return {
    timerId: t.id,
    type: t.entityType,
    id: t.entityId,
    taskId: t.taskId ?? null,
    label: t.label,
    startedAt: t.startedAt,
    state: t.runningSince && elapsedSeconds < limit ? 'running' : 'paused',
    elapsedSeconds,
    atLimit: elapsedSeconds >= limit,
    limitSeconds: limit,
  };
}

// Writes the timer to the ledger. A parent that was deleted, or that the user
// can no longer open, can't take the time: it's discarded, with the reason (Q34).
async function logTimer(req, timer, limit, note) {
  const kind = kindOf(timer.entityType);
  const record = kind && await kind.Model.findByPk(timer.entityId);
  if (!record) return { entry: null, discarded: DISCARDED.gone };
  if (!(await kind.canAccess(req.user, record))) {
    return { entry: null, discarded: DISCARDED.denied };
  }
  // The time it counted, ending now: a paused stretch isn't work (plan 3c).
  const endedAt = new Date();
  const entry = await time.logTimerEntry(req, kind.toParent(record), {
    startedAt: new Date(endedAt.getTime() - elapsedOf(timer, limit, endedAt.getTime()) * 1000), endedAt, taskId: timer.taskId, note,
  });
  return { entry, discarded: null };
}

// Takes the timer row so only one request logs it: two stops at once, or a
// stop racing a switch elsewhere, log it once (plan 3c review). False when
// another request got there first.
async function claim(timer) {
  return (await ActiveTimer.destroy({ where: { id: timer.id } })) === 1;
}

// Puts back a claimed timer whose logging failed, so no time is lost.
async function restore(timer) {
  await ActiveTimer.create(timer.get({ plain: true }));
}

// Logs a claimed timer, putting it back if logging throws.
async function logClaimed(req, timer, limit, note) {
  try {
    return await logTimer(req, timer, limit, note);
  } catch (err) {
    await restore(timer);
    throw err;
  }
}

const cleanLabel = (label) => (typeof label === 'string' ? label.trim().slice(0, 255) || null : null);
const changed = () => new ApiError(409, 'This timer was already logged or replaced', 'TIMER_CHANGED');

// The user's own timer from the URL; anyone else's is "not there" (409, as a
// timer logged elsewhere meanwhile).
async function mine(req) {
  const id = parseRecordId(req.params.timerId);
  const t = id && await ActiveTimer.findOne({ where: { id, userId: req.user.id } });
  if (!t) throw changed();
  return t;
}

// GET /timer — the current user's timers, newest first.
const list = asyncHandler(async (req, res) => {
  const limit = await time.maxEntrySeconds();
  const timers = await ActiveTimer.findAll({ where: { userId: req.user.id }, order: [['startedAt', 'DESC'], ['id', 'DESC']] });
  for (const t of timers) await settle(t, limit); // eslint-disable-line no-await-in-loop
  res.json({ timers: timers.map((t) => shape(t, limit)), limitSeconds: limit });
});

// POST /timer/start { type: 'ticket' | 'project', id, taskId?, label?, onlyIfNone? }
// Timers on other items are left alone. On the same item: the same task
// resumes; another task's timer is logged first. With onlyIfNone (automatic
// mode) an existing timer on the item is left exactly as it is.
const start = asyncHandler(async (req, res) => {
  const { type } = req.body || {};
  const onlyIfNone = req.body?.onlyIfNone === true;
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

  const limit = await time.maxEntrySeconds();
  const target = { userId: req.user.id, entityType: type, entityId: targetId };
  const existing = await ActiveTimer.findOne({ where: target });
  let logged = null;
  let discarded = null;
  if (existing) {
    await settle(existing, limit);
    if (onlyIfNone) return res.json({ timer: shape(existing, limit), logged: null, started: false });
    if ((existing.taskId ?? null) === taskId) {
      // Starting the same timer again resumes it, unless it is at the limit.
      if (!existing.runningSince && elapsedOf(existing, limit) < limit) await existing.update({ runningSince: new Date() });
      return res.json({ timer: shape(existing, limit), logged: null, started: false });
    }
    if (await claim(existing)) ({ entry: logged, discarded } = await logClaimed(req, existing, limit));
  } else if (await ActiveTimer.count({ where: { userId: req.user.id } }) >= MAX_TIMERS) {
    throw new ApiError(400, `You can have at most ${MAX_TIMERS} timers: stop one first`, 'TOO_MANY_TIMERS');
  }

  let created;
  try {
    created = await ActiveTimer.create({
      ...target, taskId, label: cleanLabel(req.body?.label), startedAt: new Date(), runningSince: new Date(),
    });
  } catch (err) {
    // Two starts on one item at once (a double click): the other one won.
    if (!(err instanceof UniqueConstraintError)) throw err;
    const winner = await ActiveTimer.findOne({ where: target });
    return res.json({ timer: shape(winner, limit), logged, started: false });
  }
  // A replaced timer that couldn't be logged says why (Q34).
  res.status(201).json({ timer: shape(created, limit), logged, started: true, ...(discarded ? { discarded } : {}) });
});

// POST /timer/:timerId/stop { note?, discard?, entry? } — logs and clears
// the timer.
//   - discard: clears it without logging.
//   - entry: the Log time form's fields (as POST …/time takes them); the
//     timer is logged as that entry instead, in the same call (plan 3c review).
// A timer already logged or replaced elsewhere (another tab or device) is a
// 409, and nothing happens.
const stop = asyncHandler(async (req, res) => {
  const { discard, entry: form } = req.body || {};
  const existing = await mine(req);
  const limit = await time.maxEntrySeconds();
  if (discard === true) {
    await claim(existing);
    return res.json({ entry: null, discarded: true });
  }
  if (form && typeof form === 'object') {
    const kind = kindOf(existing.entityType);
    const record = kind && await kind.Model.findByPk(existing.entityId);
    const reason = !record ? DISCARDED.gone : (!(await kind.canAccess(req.user, record)) ? DISCARDED.denied : null);
    if (!(await claim(existing))) throw changed();
    if (reason) return res.json({ entry: null, discarded: true, message: reason });
    try {
      const entry = await time.createEntry(req, kind.toParent(record), form);
      return res.json({ entry });
    } catch (err) {
      await restore(existing);
      throw err;
    }
  }
  if (!(await claim(existing))) throw changed();
  const { entry, discarded } = await logClaimed(req, existing, limit, req.body?.note);
  res.json(discarded ? { entry: null, discarded: true, message: discarded } : { entry });
});

// DELETE /timer/:timerId — discards the timer without logging.
const cancel = asyncHandler(async (req, res) => {
  await claim(await mine(req));
  res.json({ ok: true });
});

// POST /timer/:timerId/pause
const pause = asyncHandler(async (req, res) => {
  const t = await mine(req);
  const limit = await time.maxEntrySeconds();
  if (t.runningSince) await t.update({ accumulatedSeconds: elapsedOf(t, limit), runningSince: null });
  res.json({ timer: shape(t, limit) });
});

// POST /timer/:timerId/resume — not past the limit: that time needs logging
// (and correcting) first.
const resume = asyncHandler(async (req, res) => {
  const t = await mine(req);
  const limit = await time.maxEntrySeconds();
  await settle(t, limit);
  if (elapsedOf(t, limit) >= limit) {
    throw new ApiError(400, `This timer reached the ${limit / 3600}-hour limit: stop it and log the time`, 'TIMER_AT_LIMIT');
  }
  if (!t.runningSince) await t.update({ runningSince: new Date() });
  res.json({ timer: shape(t, limit) });
});

module.exports = {
  list, start, stop, cancel, pause, resume,
};
