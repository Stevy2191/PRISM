// One SLA clock as a pure state machine (no database). Every clock — assign,
// response, resolution — has the same state:
//   targetMinutes  null = not tracked
//   usedMinutes    business minutes banked by earlier running spells
//   runningSince   start of the current running spell, null when stopped
//   dueAt, warnAt  derived while running; null when stopped
//   warnedAt       set by the scheduler when warnAt passes
//   breachedAt     when used time passed the target; history, never cleared
//   metAt          set by the caller (first response, resolution time…)
// Functions return a new state; callers decide when a clock should run.
const { addBusinessMinutes, businessMinutesBetween } = require('./businessTime');

function emptyClock(targetMinutes) {
  return {
    targetMinutes: targetMinutes ?? null,
    usedMinutes: 0,
    runningSince: null,
    dueAt: null,
    warnAt: null,
    warnedAt: null,
    breachedAt: null,
    metAt: null,
  };
}

const warnMinutes = (target, pct) => Math.ceil((target * pct) / 100);

function derive(state, calendar, warnPct) {
  if (state.targetMinutes === null || !state.runningSince) return { ...state, dueAt: null, warnAt: null };
  const left = (minutes) => Math.max(0, minutes - state.usedMinutes);
  return {
    ...state,
    dueAt: addBusinessMinutes(state.runningSince, left(state.targetMinutes), calendar),
    warnAt: addBusinessMinutes(state.runningSince, left(warnMinutes(state.targetMinutes, warnPct)), calendar),
  };
}

function startClock(state, now, calendar, warnPct) {
  if (state.targetMinutes === null || state.runningSince) return derive(state, calendar, warnPct);
  return derive({ ...state, runningSince: new Date(now) }, calendar, warnPct);
}

// Banks the running spell. A clock that stops past its target is breached
// at its due time (or now, if no due time was derived).
function stopClock(state, now, calendar, warnPct) {
  if (!state.runningSince) return derive(state, calendar, warnPct);
  const used = state.usedMinutes + businessMinutesBetween(state.runningSince, now, calendar);
  let { breachedAt } = state;
  if (!breachedAt && state.targetMinutes !== null && used > state.targetMinutes) {
    breachedAt = state.dueAt && new Date(state.dueAt) <= new Date(now) ? new Date(state.dueAt) : new Date(now);
  }
  return derive({
    ...state, usedMinutes: used, runningSince: null, breachedAt,
  }, calendar, warnPct);
}

// New target (priority or policy change): bank, switch target, breach now if
// already past it, restart if the clock should run.
function retarget(state, targetMinutes, now, calendar, warnPct, shouldRun) {
  const banked = stopClock(state, now, calendar, warnPct);
  const target = targetMinutes ?? null;
  let { breachedAt } = banked;
  if (!breachedAt && target !== null && banked.usedMinutes > target) breachedAt = new Date(now);
  const next = { ...banked, targetMinutes: target, breachedAt };
  return shouldRun ? startClock(next, now, calendar, warnPct) : derive(next, calendar, warnPct);
}

module.exports = {
  emptyClock, derive, startClock, stopClock, retarget,
};
