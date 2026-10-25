import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTasks, groupByPhase, daysUntil, rowPeople, loggedText, shortDate, dateRange,
} from './taskFilters.js';

const t = (id, extra = {}) => ({
  id, title: `T${id}`, assigneeId: null, helpers: [], waitingOn: [], dueDate: null, isComplete: false, ...extra,
});
const ids = (list) => list.map((x) => x.id);

test('groupByPhase keeps empty phases and puts No phase last', () => {
  const phases = [{ id: 2, name: 'Build', position: 2 }, { id: 1, name: 'Plan', position: 1 }, { id: 3, name: 'Close', position: 3 }];
  const groups = groupByPhase([t(1, { phaseId: 2 }), t(2, { phaseId: null }), t(3, { phaseId: 2 })], phases);
  assert.deepEqual(groups.map((g) => g.phase && g.phase.name), ['Plan', 'Build', 'Close', null]);
  assert.deepEqual(groups.map((g) => ids(g.tasks)), [[], [1, 3], [], [2]]);
});

test('groupByPhase leaves out No phase when every task has one', () => {
  const groups = groupByPhase([t(1, { phaseId: 1 })], [{ id: 1, name: 'Plan', position: 1 }]);
  assert.equal(groups.length, 1);
});

test('filter waiting/overdue/mine', () => {
  const ctx = { userId: 7, today: '2026-11-10' };
  const tasks = [
    t(1, { waitingOn: [{ id: 9 }] }),
    t(2, { waitingOn: [{ id: 9 }], isComplete: true }),
    t(3, { dueDate: '2026-11-09' }),
    t(4, { dueDate: '2026-11-10' }),
    t(5, { dueDate: '2026-11-01', isComplete: true }),
    t(6, { assigneeId: 7 }),
  ];
  assert.deepEqual(ids(filterTasks(tasks, 'waiting', ctx)), [1]);
  assert.deepEqual(ids(filterTasks(tasks, 'overdue', ctx)), [3]);
  assert.deepEqual(ids(filterTasks(tasks, 'mine', ctx)), [6]);
  assert.deepEqual(ids(filterTasks(tasks, 'done', ctx)), [2, 5]);
  assert.deepEqual(ids(filterTasks(tasks, 'unassigned', ctx)), [1, 3, 4]);
  assert.equal(filterTasks(tasks, 'all', ctx).length, 6);
});

test('mine includes tasks I help on', () => {
  const tasks = [t(1, { assigneeId: 3, helpers: [{ id: 7, name: 'Me' }] }), t(2, { assigneeId: 3 })];
  assert.deepEqual(ids(filterTasks(tasks, 'mine', { userId: 7, today: '2026-01-01' })), [1]);
});

test('daysUntil uses string dates', () => {
  assert.equal(daysUntil('2026-11-03', '2026-11-14'), 11);
  assert.equal(daysUntil('2026-11-14', '2026-11-14'), 0);
  assert.equal(daysUntil('2026-11-14', '2026-11-10'), -4);
  assert.equal(daysUntil('2026-02-27', '2026-03-02'), 3);
  assert.equal(daysUntil('2026-03-07', '2026-03-09'), 2);
});

test('rowPeople lists the main assignee first, then helpers, once each', () => {
  const task = t(1, {
    assigneeId: 2, assignee: { id: 2, displayName: 'Sam Lee' }, helpers: [{ id: 4, name: 'Priya Nair' }, { id: 2, name: 'Sam Lee' }],
  });
  assert.deepEqual(rowPeople(task).map((p) => p.name), ['Sam Lee', 'Priya Nair']);
  assert.deepEqual(rowPeople(t(2)), []);
});

test('loggedText shows person-hours and who when more than one person logged', () => {
  assert.equal(loggedText(t(1, { loggedSeconds: 10800, loggedBy: 2 })), '3 h logged by 2 people');
  assert.equal(loggedText(t(1, { loggedSeconds: 9 * 3600, loggedBy: 1, estimateMinutes: 960 })), '9 / 16 h');
  assert.equal(loggedText(t(1, { loggedSeconds: 0, loggedBy: 0, estimateMinutes: 360 })), '0 / 6 h');
  assert.equal(loggedText(t(1, { loggedSeconds: 5400, loggedBy: 1 })), '1.5 h');
  assert.equal(loggedText(t(1, { isMilestone: true })), 'Milestone');
});

test('dates read as short month and day', () => {
  assert.equal(shortDate('2026-11-04'), 'Nov 4');
  assert.equal(dateRange('2026-10-30', '2026-11-02'), 'Oct 30 – Nov 2');
  assert.equal(dateRange('2026-11-04', '2026-11-04'), 'Nov 4');
  assert.equal(dateRange(null, '2026-11-04'), 'Nov 4');
  assert.equal(dateRange(null, null), '');
});
