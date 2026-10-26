import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dropPatch, shiftFrom, mondayOf, rangeLabel, hoursLabel, cellState, dayHeader, canDrop,
} from './dispatch.js';

const ticket = { kind: 'ticket', id: 10490, projectId: null, dueDate: '2026-11-05', plannedDate: null, canEdit: true };
const dated = { kind: 'task', id: 7, projectId: 3, startDate: '2026-11-10', dueDate: '2026-11-12', canEdit: true };
const undated = { kind: 'task', id: 8, projectId: 3, startDate: null, dueDate: null, canEdit: true };

test('ticket drop sets plannedDate not dueDate', () => {
  const { url, body } = dropPatch(ticket, 5, '2026-11-05');
  assert.equal(url, '/tickets/10490');
  assert.deepEqual(body, { assigneeId: 5, plannedDate: '2026-11-05' });
  assert.ok(!('dueDate' in body));
});

test('dated task keeps its length', () => {
  const { url, body } = dropPatch(dated, 5, '2026-11-16');
  assert.equal(url, '/projects/3/tasks/7');
  assert.deepEqual(body, { assigneeId: 5, startDate: '2026-11-16', dueDate: '2026-11-18' });
  // A task with only a due date is one day long.
  assert.deepEqual(dropPatch({ ...dated, startDate: null }, 5, '2026-11-16').body, { assigneeId: 5, startDate: '2026-11-16', dueDate: '2026-11-16' });
});

test('undated task gets one day', () => {
  assert.deepEqual(dropPatch(undated, 5, '2026-11-09').body, { assigneeId: 5, startDate: '2026-11-09', dueDate: '2026-11-09' });
});

test('No date column only reassigns', () => {
  assert.deepEqual(dropPatch(ticket, 5, 'none').body, { assigneeId: 5 });
  assert.deepEqual(dropPatch(dated, 5, 'none').body, { assigneeId: 5 });
  assert.deepEqual(dropPatch(dated, 5, null).body, { assigneeId: 5 });
});

test('a task keeps its length across a month end', () => {
  assert.deepEqual(dropPatch(dated, 5, '2026-11-30').body, { assigneeId: 5, startDate: '2026-11-30', dueDate: '2026-12-02' });
});

test('only items you can edit may be dropped', () => {
  assert.equal(canDrop(ticket), true);
  assert.equal(canDrop({ ...ticket, canEdit: false }), false);
});

test('range maths stays on Mondays', () => {
  assert.equal(mondayOf('2026-11-05'), '2026-11-02');
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); // a Sunday
  assert.equal(shiftFrom('2026-11-02', 10, 1), '2026-11-16');
  assert.equal(shiftFrom('2026-11-02', 5, -1), '2026-10-26');
});

test('labels', () => {
  assert.equal(rangeLabel(['2026-11-02', '2026-11-13']), 'Nov 2 – Nov 13');
  assert.equal(hoursLabel(510), '8.5 h');
  assert.equal(hoursLabel(420), '7 h');
  assert.equal(hoursLabel(160), '2.7 h');
  assert.equal(hoursLabel(0), '0 h');
  assert.deepEqual(dayHeader('2026-11-04'), { weekday: 'Wed', day: 4 });
});

test('cell state: holiday/off, free, over, normal', () => {
  assert.equal(cellState({ minutes: 0, capacity: 0, count: 0 }), 'off');
  assert.equal(cellState({ minutes: 0, capacity: 480, count: 0 }), 'free');
  assert.equal(cellState({ minutes: 480, capacity: 480, count: 2 }), 'normal');
  assert.equal(cellState({ minutes: 481, capacity: 480, count: 2 }), 'over');
  assert.equal(cellState({ minutes: 60, capacity: 0, count: 1 }), 'over');
});

// A task the drop target is already on (main assignee or helper) only moves
// dates: sending assigneeId would make a helper the main assignee.
const shared = { ...dated, peopleIds: [4, 5] }; // 4 is main, 5 a helper

test('drop in a helper row moves the dates only', () => {
  assert.deepEqual(dropPatch(shared, 5, '2026-11-16').body, { startDate: '2026-11-16', dueDate: '2026-11-18' });
  assert.deepEqual(dropPatch(shared, 4, '2026-11-16').body, { startDate: '2026-11-16', dueDate: '2026-11-18' });
});

test('drop on someone not on the task makes them the main assignee', () => {
  assert.deepEqual(dropPatch(shared, 9, '2026-11-16').body, { assigneeId: 9, startDate: '2026-11-16', dueDate: '2026-11-18' });
  assert.deepEqual(dropPatch(shared, 9, 'none').body, { assigneeId: 9 });
});

test('No date column on someone already on the task is no change at all', () => {
  assert.equal(dropPatch(shared, 5, 'none'), null);
});
