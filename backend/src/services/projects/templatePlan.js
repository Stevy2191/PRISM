'use strict';

// Turns a project template into dated tasks (sub-project 6). Pure: no
// database. A template task has `startDay` (1 = the project's first day) and
// `lengthDays` (0 = milestone, else at least 1); dates come out as
// 'YYYY-MM-DD' strings. All day maths goes through schedule.js.
const { addDays, daysBetween, stretch } = require('./schedule');

// Last day a template task covers, counted from day 0 (a milestone covers one).
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

// shape: { phases, tasks, dependencies }. Options: startDate (required), and
// finishDate, which scales the whole plan (every offset and length by new
// span / template span, rounded, a task keeping at least one day). After a
// scale a waiting task that now starts on or before its predecessor's last
// day is pushed to the day after, taking its subtasks with it. Without a
// finishDate the template's own offsets are used as stored.
function planFromTemplate(shape, { startDate, finishDate } = {}) {
  const tasks = shape.tasks || [];
  const span = templateSpan(tasks);
  const wanted = finishDate ? daysBetween(startDate, finishDate) + 1 : span;
  const ratio = span > 0 && wanted > 0 ? wanted / span : 1;
  const scaled = ratio !== 1;

  const bars = new Map(tasks.map((t) => {
    const { offset, length } = scaled ? stretch(t.startDay - 1, t.lengthDays, ratio) : { offset: t.startDay - 1, length: t.lengthDays };
    return [t.id, { start: offset, end: offset + Math.max(length, 1) - 1 }];
  }));

  if (scaled) {
    const top = tasks.filter((t) => !t.parentId).map((t) => t.id);
    const subtasksOf = new Map();
    for (const t of tasks) {
      if (t.parentId) subtasksOf.set(t.parentId, [...(subtasksOf.get(t.parentId) || []), t.id]);
    }
    const deps = shape.dependencies || [];
    for (const id of orderedIds(top, deps)) {
      const bar = bars.get(id);
      const lastBefore = deps.filter((d) => d.successorId === id).reduce((max, d) => Math.max(max, bars.get(d.predecessorId).end), -1);
      if (bar.start <= lastBefore) {
        const push = lastBefore + 1 - bar.start;
        for (const moved of [id, ...(subtasksOf.get(id) || [])]) {
          const b = bars.get(moved);
          b.start += push;
          b.end += push;
        }
      }
    }
  }

  const planned = tasks.map((t) => {
    const bar = bars.get(t.id);
    return { ...t, startDate: addDays(startDate, bar.start), dueDate: addDays(startDate, bar.end) };
  });
  const last = planned.reduce((max, t) => (t.dueDate > max ? t.dueDate : max), startDate);
  return {
    phases: (shape.phases || []).map((p) => ({ ...p })),
    tasks: planned,
    dependencies: (shape.dependencies || []).map((d) => ({ ...d })),
    finishDate: last,
  };
}

module.exports = { planFromTemplate, templateSpan };
