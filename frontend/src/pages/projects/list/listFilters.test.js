import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listParams, pickTile, hoursText, budgetPercent, deptParams, tileParams, isLate,
} from './listFilters.js';

const base = { pill: 'open', attention: '', companyId: '', tag: '', search: '', today: '2026-03-10' };

test('the pills map to state and mine', () => {
  assert.deepEqual(listParams(base), { state: 'open' });
  assert.deepEqual(listParams({ ...base, pill: 'mine' }), { state: 'open', mine: 'member' });
  assert.deepEqual(listParams({ ...base, pill: 'lead' }), { state: 'open', mine: 'lead' });
  assert.deepEqual(listParams({ ...base, pill: 'closed' }), { state: 'closed' });
  assert.deepEqual(listParams({ ...base, pill: 'all' }), {});
});

test('an attention tile sends the local date; the rest only when set', () => {
  assert.deepEqual(listParams({ ...base, attention: 'milestones_7d', tag: 'vpn', search: 'x', companyId: '3' }), {
    state: 'open', attention: 'milestones_7d', today: '2026-03-10', tag: 'vpn', search: 'x', companyId: '3',
  });
});

test('a tile toggles, and leaves Closed', () => {
  const on = pickTile({ ...base, pill: 'closed' }, 'over_budget');
  assert.equal(on.attention, 'over_budget');
  assert.equal(on.pill, 'open');
  assert.equal(pickTile(on, 'over_budget').attention, '');
  assert.equal(pickTile(on, 'unassigned').attention, 'unassigned');
});

test('hours show one decimal at most', () => {
  assert.equal(hoursText(4470), '74.5');
  assert.equal(hoursText(120), '2');
  assert.equal(hoursText(0), '0');
  assert.equal(hoursText(null), '0');
});

test('budget percent', () => {
  assert.equal(budgetPercent(88 * 60, 80 * 60), 110);
  assert.equal(budgetPercent(5, null), null);
  assert.equal(budgetPercent(5, 0), null);
});

test('department and status filters', () => {
  assert.deepEqual(deptParams('mine'), { myDepartment: 'true' });
  assert.deepEqual(deptParams('owner:4'), { ownerDept: '4' });
  assert.deepEqual(deptParams('for:7'), { forDept: '7' });
  assert.deepEqual(deptParams(''), {});
  assert.deepEqual(listParams({ ...base, dept: 'for:7', status: 'On hold' }), { forDept: '7', status: 'On hold' });
  assert.deepEqual(tileParams({ companyId: '2', dept: 'owner:4', today: '2026-03-10' }), { today: '2026-03-10', companyId: '2', ownerDept: '4' });
});

test('late means past and open', () => {
  assert.equal(isLate('2026-03-09', '2026-03-10', false), true);
  assert.equal(isLate('2026-03-10', '2026-03-10', false), false);
  assert.equal(isLate('2026-03-09', '2026-03-10', true), false);
  assert.equal(isLate(null, '2026-03-10', false), false);
});
