// The template editor's state and the edits made to it (sub-project 6). Pure:
// no React, so node:test can run it. Ids are the server's numbers for rows
// that exist and 'n1', 'n2'... for new ones; the server swaps in real ids on
// save. Order in the arrays is the order on screen and in the saved template.
import { parseHours, hoursInput } from '../../projects/detail/budgetFormat.js';

let counter = 0;
export const newId = () => { counter += 1; return `n${counter}`; };

export const emptyTemplate = () => ({
  name: '', description: '', hours: '', tags: [], phases: [], tasks: [], dependencies: [],
});

export function fromServer(t) {
  return {
    name: t.name || '',
    description: t.description || '',
    hours: hoursInput(t.hourBudgetMinutes),
    tags: t.tags || [],
    phases: (t.phases || []).map((p) => ({ id: p.id, name: p.name, hourBudgetMinutes: p.hourBudgetMinutes ?? null })),
    tasks: (t.tasks || []).map((x) => ({ ...x, phaseId: x.parentId ? null : x.phaseId ?? null })),
    dependencies: (t.dependencies || []).map((d) => ({ ...d })),
  };
}

// The request body for POST/PUT, or { error } when the hour budget is not a number.
export function toPayload(s) {
  const minutes = parseHours(s.hours);
  if (Number.isNaN(minutes)) return { error: 'Hour budget must be a number of hours, like 80 or 7.5' };
  return {
    body: {
      name: s.name.trim(),
      description: s.description.trim() || null,
      hourBudgetMinutes: minutes,
      tags: s.tags,
      phases: s.phases.map((p) => ({ id: p.id, name: p.name, hourBudgetMinutes: p.hourBudgetMinutes ?? null })),
      tasks: s.tasks.map((t) => ({
        id: t.id,
        parentId: t.parentId ?? null,
        phaseId: t.parentId ? null : t.phaseId ?? null,
        title: t.title,
        description: t.description ?? null,
        startDay: t.startDay,
        lengthDays: t.isMilestone ? 0 : t.lengthDays,
        estimateMinutes: t.isMilestone ? null : t.estimateMinutes ?? null,
        priority: t.priority || 'medium',
        isMilestone: !!t.isMilestone,
      })),
      dependencies: s.dependencies,
    },
  };
}

const sameId = (a, b) => String(a) === String(b);
export const subtasksOf = (s, id) => s.tasks.filter((t) => t.parentId != null && sameId(t.parentId, id));

// Rows in display order: loose tasks first, then each phase and its tasks,
// every task followed by its subtasks. [{ kind: 'phase'|'task', ... }]
export function rowsFor(s) {
  const top = s.tasks.filter((t) => t.parentId == null);
  const rows = [];
  const pushTasks = (list) => {
    for (const t of list) {
      rows.push({ kind: 'task', task: t, sub: false });
      for (const x of subtasksOf(s, t.id)) rows.push({ kind: 'task', task: x, sub: true });
    }
  };
  const loose = top.filter((t) => t.phaseId == null || !s.phases.some((p) => sameId(p.id, t.phaseId)));
  if (loose.length) pushTasks(loose);
  for (const p of s.phases) {
    rows.push({ kind: 'phase', phase: p });
    pushTasks(top.filter((t) => t.phaseId != null && sameId(t.phaseId, p.id)));
  }
  return rows;
}

// What a phase row shows: first day, length and total estimate of its tasks.
export function phaseSummary(s, phaseId) {
  const mine = s.tasks.filter((t) => t.parentId == null && t.phaseId != null && sameId(t.phaseId, phaseId));
  if (!mine.length) return null;
  const start = Math.min(...mine.map((t) => t.startDay));
  const end = Math.max(...mine.map((t) => t.startDay - 1 + Math.max(t.lengthDays, 1)));
  const ids = new Set(mine.map((t) => String(t.id)));
  const inside = s.tasks.filter((t) => !t.isMilestone && (t.parentId == null ? ids.has(String(t.id)) : ids.has(String(t.parentId))));
  const minutes = inside.reduce((sum, t) => sum + (t.estimateMinutes || 0), 0);
  return { start, days: end - start + 1, minutes };
}

export function addPhase(s, name) {
  return { ...s, phases: [...s.phases, { id: newId(), name, hourBudgetMinutes: null }] };
}

// A new task goes at the end of its phase, starting where the phase's last task ends.
export function addTask(s, phaseId, title) {
  const inPhase = s.tasks.filter((t) => t.parentId == null && (phaseId == null ? t.phaseId == null : t.phaseId != null && sameId(t.phaseId, phaseId)));
  const startDay = inPhase.length ? Math.max(...inPhase.map((t) => t.startDay)) : 1;
  const task = {
    id: newId(), parentId: null, phaseId: phaseId ?? null, title, description: null, startDay, lengthDays: 1, estimateMinutes: null, priority: 'medium', isMilestone: false,
  };
  const at = lastIndexOfPhase(s, phaseId);
  const tasks = [...s.tasks];
  tasks.splice(at, 0, task);
  return { ...s, tasks };
}

// Index just after the last task (and its subtasks) of a phase, in s.tasks.
function lastIndexOfPhase(s, phaseId) {
  let last = -1;
  s.tasks.forEach((t, i) => {
    const top = t.parentId == null ? t : s.tasks.find((x) => sameId(x.id, t.parentId));
    const inIt = top && (phaseId == null ? top.phaseId == null : top.phaseId != null && sameId(top.phaseId, phaseId));
    if (inIt) last = i;
  });
  return last < 0 ? s.tasks.length : last + 1;
}

export function updateTask(s, id, patch) {
  return { ...s, tasks: s.tasks.map((t) => (sameId(t.id, id) ? { ...t, ...patch } : t)) };
}

export function renamePhase(s, id, name) {
  return { ...s, phases: s.phases.map((p) => (sameId(p.id, id) ? { ...p, name } : p)) };
}

// A milestone is a point (0 days, no estimate); turning one back gives 1 day.
export function setMilestone(s, id, on) {
  if (on && subtasksOf(s, id).length) return s; // a milestone can't have subtasks
  return updateTask(s, id, on ? { isMilestone: true, lengthDays: 0, estimateMinutes: null } : { isMilestone: false, lengthDays: 1 });
}

// Removes the tasks (and their subtasks) and every link to them.
function dropTasks(s, ids) {
  const gone = new Set(ids.map(String));
  return {
    ...s,
    tasks: s.tasks.filter((t) => !gone.has(String(t.id))),
    dependencies: s.dependencies.filter((d) => !gone.has(String(d.predecessorId)) && !gone.has(String(d.successorId))),
  };
}

export function removeTask(s, id) {
  return dropTasks(s, [id, ...subtasksOf(s, id).map((t) => t.id)]);
}

export function removePhase(s, id) {
  const inside = s.tasks.filter((t) => t.parentId == null && t.phaseId != null && sameId(t.phaseId, id)).map((t) => t.id);
  const next = dropTasks(s, inside.flatMap((tid) => [tid, ...subtasksOf(s, tid).map((t) => t.id)]));
  return { ...next, phases: next.phases.filter((p) => !sameId(p.id, id)) };
}

export function addWait(s, taskId, predecessorId) {
  if (sameId(taskId, predecessorId) || s.dependencies.some((d) => sameId(d.successorId, taskId) && sameId(d.predecessorId, predecessorId))) return s;
  return { ...s, dependencies: [...s.dependencies, { predecessorId, successorId: taskId }] };
}

export function removeWait(s, taskId, predecessorId) {
  return { ...s, dependencies: s.dependencies.filter((d) => !(sameId(d.successorId, taskId) && sameId(d.predecessorId, predecessorId))) };
}

// The tasks and subtasks with these ids, in order, as one block.
const blockOf = (s, id) => {
  const ids = new Set([String(id), ...subtasksOf(s, id).map((t) => String(t.id))]);
  return s.tasks.filter((t) => ids.has(String(t.id)));
};

// Drag a task onto another row: it lands just before that task, in its phase.
// Subtasks only move among their own siblings.
export function moveTask(s, id, beforeId) {
  if (sameId(id, beforeId)) return s;
  const moving = s.tasks.find((t) => sameId(t.id, id));
  const target = s.tasks.find((t) => sameId(t.id, beforeId));
  if (!moving || !target) return s;
  if (moving.parentId != null) {
    if (target.parentId == null || !sameId(target.parentId, moving.parentId)) return s;
    const rest = s.tasks.filter((t) => !sameId(t.id, id));
    rest.splice(rest.findIndex((t) => sameId(t.id, beforeId)), 0, moving);
    return { ...s, tasks: rest };
  }
  if (target.parentId != null) return s;
  const block = blockOf(s, id).map((t) => (t === moving ? { ...t, phaseId: target.phaseId } : t));
  const rest = s.tasks.filter((t) => !block.some((b) => sameId(b.id, t.id)));
  rest.splice(rest.findIndex((t) => sameId(t.id, beforeId)), 0, ...block);
  return { ...s, tasks: rest };
}

// Drag a task onto a phase's row: it goes to the end of that phase.
export function moveTaskToPhase(s, id, phaseId) {
  const moving = s.tasks.find((t) => sameId(t.id, id));
  if (!moving || moving.parentId != null) return s;
  const block = blockOf(s, id).map((t) => (t === moving ? { ...t, phaseId } : t));
  const rest = s.tasks.filter((t) => !block.some((b) => sameId(b.id, t.id)));
  const next = { ...s, tasks: rest };
  const at = lastIndexOfPhase(next, phaseId);
  rest.splice(at, 0, ...block);
  return next;
}

export function movePhase(s, id, beforeId) {
  if (sameId(id, beforeId)) return s;
  const moving = s.phases.find((p) => sameId(p.id, id));
  if (!moving || !s.phases.some((p) => sameId(p.id, beforeId))) return s;
  const rest = s.phases.filter((p) => !sameId(p.id, id));
  rest.splice(rest.findIndex((p) => sameId(p.id, beforeId)), 0, moving);
  return { ...s, phases: rest };
}
