import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromServer, toPayload, rowsFor, addTask, addPhase, addWait, removeWait, removeTask, removePhase,
  moveTask, moveTaskToPhase, movePhase, setMilestone, phaseSummary,
} from './model.js';

const base = () => fromServer({
  name: 'N', hourBudgetMinutes: 90, tags: ['a'],
  phases: [{ id: 1, name: 'Plan' }, { id: 2, name: 'Build' }],
  tasks: [
    { id: 10, parentId: null, phaseId: 1, title: 'A', startDay: 1, lengthDays: 2, estimateMinutes: 60, isMilestone: false },
    { id: 11, parentId: 10, phaseId: null, title: 'A sub', startDay: 1, lengthDays: 1, estimateMinutes: 30, isMilestone: false },
    { id: 12, parentId: null, phaseId: 1, title: 'B', startDay: 3, lengthDays: 1, estimateMinutes: null, isMilestone: false },
    { id: 13, parentId: null, phaseId: 2, title: 'C', startDay: 4, lengthDays: 2, estimateMinutes: 120, isMilestone: false },
  ],
  dependencies: [{ predecessorId: 10, successorId: 12 }],
});
const titles = (s) => rowsFor(s).map((r) => (r.kind === 'phase' ? `[${r.phase.name}]` : r.task.title));

test('rows show each phase then its tasks, subtasks under their task', () => {
  assert.deepEqual(titles(base()), ['[Plan]', 'A', 'A sub', 'B', '[Build]', 'C']);
});

test('payload round-trips the server shape and turns hours into minutes', () => {
  const { body } = toPayload(base());
  assert.equal(body.hourBudgetMinutes, 90);
  assert.equal(body.tasks[1].parentId, 10);
  assert.equal(toPayload({ ...base(), hours: '2.5' }).body.hourBudgetMinutes, 150);
  assert.equal(toPayload({ ...base(), hours: '' }).body.hourBudgetMinutes, null);
  assert.ok(toPayload({ ...base(), hours: 'lots' }).error);
});

test('a new task lands at the end of its phase', () => {
  const s = addTask(base(), 1, 'New');
  assert.deepEqual(titles(s), ['[Plan]', 'A', 'A sub', 'B', 'New', '[Build]', 'C']);
  assert.equal(addPhase(s, 'Close').phases.length, 3);
});

test('waits on adds once, never to itself, and removes', () => {
  let s = addWait(base(), 13, 12);
  s = addWait(s, 13, 12);
  s = addWait(s, 13, 13);
  assert.equal(s.dependencies.length, 2);
  assert.equal(removeWait(s, 13, 12).dependencies.length, 1);
});

test('removing a task takes its subtasks and links; removing a phase takes its tasks', () => {
  const s = removeTask(base(), 10);
  assert.deepEqual(titles(s), ['[Plan]', 'B', '[Build]', 'C']);
  assert.equal(s.dependencies.length, 0);
  assert.deepEqual(titles(removePhase(base(), 1)), ['[Build]', 'C']);
});

test('drag: a task moves before another and takes its phase; subtasks stay with it', () => {
  assert.deepEqual(titles(moveTask(base(), 13, 10)), ['[Plan]', 'C', 'A', 'A sub', 'B', '[Build]']);
  assert.deepEqual(titles(moveTask(base(), 10, 13)), ['[Plan]', 'B', '[Build]', 'A', 'A sub', 'C']);
  assert.deepEqual(titles(moveTaskToPhase(base(), 12, 2)), ['[Plan]', 'A', 'A sub', '[Build]', 'C', 'B']);
  assert.equal(moveTask(base(), 11, 12).tasks.length, 4); // a subtask can't leave its parent
  assert.deepEqual(movePhase(base(), 2, 1).phases.map((p) => p.name), ['Build', 'Plan']);
});

test('milestone toggle zeroes the length; not with subtasks', () => {
  const s = setMilestone(base(), 12, true);
  assert.equal(s.tasks.find((t) => t.id === 12).lengthDays, 0);
  assert.equal(setMilestone(base(), 10, true).tasks.find((t) => t.id === 10).isMilestone, false);
  assert.equal(setMilestone(s, 12, false).tasks.find((t) => t.id === 12).lengthDays, 1);
});

test('phase summary: first day, days taken and estimate', () => {
  assert.deepEqual(phaseSummary(base(), 1), { start: 1, days: 3, minutes: 90 });
  assert.equal(phaseSummary(addPhase(base(), 'Empty'), 'n-none'), null);
});
