'use strict';

// Turns a project template into dated tasks (sub-project 6). Pure: no
// database. A template task has `startDay` (1 = the project's first day) and
// `lengthDays` (0 = milestone, else at least 1); dates come out as
// 'YYYY-MM-DD' strings. All day maths goes through schedule.js.
const { ApiError } = require('../../middleware/error');
const { addDays, daysBetween } = require('./schedule');

const MAX_DAYS = 3650;

// End position of a template task, counted from day 0 (a milestone covers one).
const endOffset = (t) => (t.startDay - 1) + Math.max(t.lengthDays, 1);

// The template's length in days.
function templateSpan(tasks) {
  return tasks.reduce((max, t) => Math.max(max, endOffset(t)), 0);
}

// Topological order of the ids that appear in `deps` (predecessors first).
// Ids caught in a loop are left out; structure validation rejects loops.
function orderedIds(ids, deps) {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const next = new Map();
  for (const d of deps) {
    if (!indegree.has(d.predecessorId) || !indegree.has(d.successorId)) continue; // eslint-disable-line no-continue
    indegree.set(d.successorId, indegree.get(d.successorId) + 1);
    if (!next.has(d.predecessorId)) next.set(d.predecessorId, []);
    next.get(d.predecessorId).push(d.successorId);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of next.get(id) || []) {
      indegree.set(s, indegree.get(s) - 1);
      if (indegree.get(s) === 0) queue.push(s);
    }
  }
  return order;
}

// Scale a bar by ratio by its END positions, so the last day of the template
// lands on the last day of the plan. o = days before the bar, length >= 0
// (0 = milestone). Returns inclusive first and last day offsets.
function scaleBar(o, length, ratio) {
  const start = Math.round(o * ratio);
  if (length === 0) return { start: Math.round((o + 1) * ratio) - 1, end: Math.round((o + 1) * ratio) - 1 };
  return { start, end: Math.max(start, Math.round((o + length) * ratio) - 1) };
}

const tooFar = (date) => date.length > 10; // a year past 9999

// shape: { phases, tasks, dependencies }. Options: startDate (required), and
// finishDate, which scales the whole plan (every position by new span /
// template span, rounded, a task keeping at least one day). A waiting task
// that starts on or before its predecessor's last day is pushed to the day
// after, taking its subtasks with it; a milestone may sit on that last day.
// A plan longer than MAX_DAYS, or past the year 9999, is refused.
function planFromTemplate(shape, { startDate, finishDate } = {}) {
  const tasks = shape.tasks || [];
  const span = templateSpan(tasks);
  if (finishDate && daysBetween(startDate, finishDate) + 1 > MAX_DAYS) throw new ApiError(400, `A plan can be at most ${MAX_DAYS} days long`, 'VALIDATION_ERROR');
  const wanted = finishDate ? daysBetween(startDate, finishDate) + 1 : span;
  const ratio = span > 0 && wanted > 0 ? wanted / span : 1;

  const bars = new Map(tasks.map((t) => [t.id, scaleBar(t.startDay - 1, t.lengthDays, ratio)]));
  const milestones = new Set(tasks.filter((t) => t.lengthDays === 0).map((t) => t.id));

  const top = tasks.filter((t) => !t.parentId).map((t) => t.id);
  const subtasksOf = new Map();
  for (const t of tasks) {
    if (t.parentId) subtasksOf.set(t.parentId, [...(subtasksOf.get(t.parentId) || []), t.id]);
  }
  const deps = shape.dependencies || [];
  for (const id of orderedIds(top, deps)) {
    const bar = bars.get(id);
    const lastBefore = deps.filter((d) => d.successorId === id).reduce((max, d) => Math.max(max, bars.get(d.predecessorId).end), -1);
    const clash = milestones.has(id) ? bar.start < lastBefore : bar.start <= lastBefore;
    if (clash) {
      const push = (milestones.has(id) ? lastBefore : lastBefore + 1) - bar.start;
      for (const moved of [id, ...(subtasksOf.get(id) || [])]) {
        const b = bars.get(moved);
        b.start += push;
        b.end += push;
      }
    }
  }

  const planned = tasks.map((t) => {
    const bar = bars.get(t.id);
    return { ...t, startDate: addDays(startDate, bar.start), dueDate: addDays(startDate, bar.end) };
  });
  const last = planned.reduce((max, t) => (t.dueDate > max ? t.dueDate : max), startDate);
  if (tooFar(last) || planned.some((t) => tooFar(t.startDate) || tooFar(t.dueDate))) {
    throw new ApiError(400, 'That plan runs past the year 9999', 'VALIDATION_ERROR');
  }
  return {
    phases: (shape.phases || []).map((p) => ({ ...p })),
    tasks: planned,
    dependencies: deps.map((d) => ({ ...d })),
    finishDate: last,
  };
}

module.exports = { planFromTemplate, templateSpan, MAX_DAYS };
