import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortDay, projectLine, stepLine } from './projectFormat.js';

test('portal project lines', () => {
  assert.equal(shortDay('2026-01-30'), 'Jan 30');
  assert.equal(shortDay(null), '');
  const open = { forDepartment: { name: 'Human Resources' }, statusBehavior: 'open', progress: { percent: 40 }, dueDate: '2026-01-30' };
  assert.equal(projectLine(open, 'Washington County'), 'Human Resources · 40% · due Jan 30');
  assert.equal(projectLine({ ...open, forDepartment: null }, 'Washington County'), 'All of Washington County · 40% · due Jan 30');
  assert.equal(projectLine({ ...open, statusBehavior: 'closed', completedAt: '2026-11-01T10:00:00Z' }), 'Human Resources · Completed Nov 1');
  assert.equal(stepLine({ kind: 'phase', startDate: '2026-11-18', dueDate: '2026-12-20', state: 'active' }), ' · Nov 18 to Dec 20 · in progress');
  assert.equal(stepLine({ kind: 'milestone', dueDate: '2026-01-30', state: 'todo' }), ' · Jan 30');
});
