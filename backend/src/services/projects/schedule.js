'use strict';

// Pure date and scheduling helpers for project management (sub-project 6).
// Every date is a DATEONLY 'YYYY-MM-DD' string. Day maths goes through UTC
// epoch-day integers (Date.UTC), never local-time Date methods, so the
// process time zone and DST changes cannot move a date.

const MS_DAY = 86400000;

function toEpochDay(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

function fromEpochDay(day) {
  const dt = new Date(day * MS_DAY);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const addDays = (date, n) => fromEpochDay(toEpochDay(date) + n);
const daysBetween = (a, b) => toEpochDay(b) - toEpochDay(a);

// 1 = Monday ... 7 = Sunday. Epoch day 0 (1970-01-01) was a Thursday.
const isoWeekday = (date) => (((toEpochDay(date) + 3) % 7) + 7) % 7 + 1;

// Earliest start and latest due among the dated tasks; null when none has a date.
function phaseSpan(tasks) {
  let startDate = null;
  let dueDate = null;
  for (const t of tasks) {
    if (t.startDate && (!startDate || t.startDate < startDate)) startDate = t.startDate;
    if (t.dueDate && (!dueDate || t.dueDate > dueDate)) dueDate = t.dueDate;
  }
  return startDate || dueDate ? { startDate, dueDate } : null;
}

// Predecessors of taskId that are not done (waiting is derived, never stored).
const waitingOn = (taskId, deps, doneIds) => deps
  .filter((d) => d.successorId === taskId && !doneIds.has(d.predecessorId))
  .map((d) => d.predecessorId);

function successorMap(deps) {
  const map = new Map();
  for (const d of deps) {
    if (!map.has(d.predecessorId)) map.set(d.predecessorId, []);
    map.get(d.predecessorId).push(d.successorId);
  }
  return map;
}

// Would adding predecessor -> successor close a loop? True when the successor
// already reaches the predecessor (or they are the same task).
function wouldCycle(deps, predecessorId, successorId) {
  if (predecessorId === successorId) return true;
  const next = successorMap(deps);
  const seen = new Set();
  const stack = [successorId];
  while (stack.length) {
    const id = stack.pop();
    if (id === predecessorId) return true;
    if (!seen.has(id)) {
      seen.add(id);
      stack.push(...(next.get(id) || []));
    }
  }
  return false;
}

// Everything that transitively waits on taskId, each once, in topological
// order (a task always comes after all of its predecessors within the set).
function downstream(deps, taskId) {
  const next = successorMap(deps);
  const reach = new Set();
  const stack = [taskId];
  while (stack.length) {
    for (const id of next.get(stack.pop()) || []) {
      if (!reach.has(id)) {
        reach.add(id);
        stack.push(id);
      }
    }
  }
  // Kahn's algorithm over the reachable subgraph.
  const indegree = new Map([...reach].map((id) => [id, 0]));
  for (const d of deps) {
    if (reach.has(d.predecessorId) && reach.has(d.successorId)) indegree.set(d.successorId, indegree.get(d.successorId) + 1);
  }
  const queue = [...reach].filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of next.get(id) || []) {
      if (reach.has(s)) {
        indegree.set(s, indegree.get(s) - 1);
        if (indegree.get(s) === 0) queue.push(s);
      }
    }
  }
  return order;
}

// New dates for the listed tasks moved by `days`; a null date stays null.
function shiftTasks(tasks, ids, days) {
  const wanted = new Set(ids);
  return tasks.filter((t) => wanted.has(t.id)).map((t) => ({
    id: t.id,
    startDate: t.startDate ? addDays(t.startDate, days) : null,
    dueDate: t.dueDate ? addDays(t.dueDate, days) : null,
  }));
}

// Scale a bar (offset from the phase start, length in days) by ratio.
// Length stays at least 1, except a milestone (length 0), which stays 0.
function stretch(offset, length, ratio) {
  return {
    offset: Math.round(offset * ratio),
    length: length === 0 ? 0 : Math.max(1, Math.round(length * ratio)),
  };
}

module.exports = { addDays, daysBetween, isoWeekday, phaseSpan, waitingOn, wouldCycle, downstream, shiftTasks, stretch };
