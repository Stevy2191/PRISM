import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM, layout, barRect, dragResult, arrowPath, isoWeekday, chartRange, daysBetween,
} from './geometry.js';

const lay = layout({ from: '2026-10-19', days: 60, zoom: ZOOM.week });

test('dayToX/xToDay round trip', () => {
  for (const date of ['2026-10-19', '2026-10-26', '2026-11-12', '2026-12-31']) {
    assert.equal(lay.xToDay(lay.dayToX(date)), date);
    // Anywhere inside the day maps back to the same day.
    assert.equal(lay.xToDay(lay.dayToX(date) + ZOOM.week - 1), date);
  }
  assert.equal(lay.dayToX('2026-10-20'), 30);
  // Across a DST change the maths stays in whole days.
  assert.equal(layout({ from: '2026-10-30', days: 10, zoom: 12 }).dayToX('2026-11-02'), 36);
});

test('barRect null when undated', () => {
  assert.equal(barRect({ startDate: null, dueDate: null }, lay), null);
  assert.deepEqual(barRect({ startDate: '2026-10-20', dueDate: '2026-10-22' }, lay), { x: 30, width: 90 });
  assert.deepEqual(barRect({ startDate: null, dueDate: '2026-10-20' }, lay), { x: 30, width: 30 });
});

test('dragResult end before start clamps to one day', () => {
  const t = { startDate: '2026-11-10', dueDate: '2026-11-12' };
  assert.deepEqual(dragResult(t, 'end', -9), { startDate: '2026-11-10', dueDate: '2026-11-10' });
  assert.deepEqual(dragResult(t, 'start', 9), { startDate: '2026-11-12', dueDate: '2026-11-12' });
  assert.deepEqual(dragResult(t, 'move', 2), { startDate: '2026-11-12', dueDate: '2026-11-14' });
  assert.deepEqual(dragResult(t, 'end', 2), { startDate: '2026-11-10', dueDate: '2026-11-14' });
});

test('milestone resize is a move', () => {
  const m = { startDate: '2026-11-13', dueDate: '2026-11-13', isMilestone: true };
  assert.deepEqual(dragResult(m, 'end', 3), { startDate: '2026-11-16', dueDate: '2026-11-16' });
  assert.deepEqual(dragResult(m, 'start', -2), { startDate: '2026-11-11', dueDate: '2026-11-11' });
});

test('arrowPath runs from the end of one bar to the start of the next', () => {
  const p = arrowPath({ x: 0, width: 50, y: 18 }, { x: 100, width: 50, y: 54 }, 36);
  assert.equal(p, 'M50 18 H58 V54 H100');
  const back = arrowPath({ x: 0, width: 100, y: 18 }, { x: 40, width: 50, y: 54 }, 36);
  assert.match(back, /^M100 18 H108 V36 H32 V54 H40$/);
});

test('weekday and range helpers', () => {
  assert.equal(isoWeekday('2026-10-25'), 7);
  const r = chartRange([{ startDate: '2026-11-02', dueDate: '2026-11-16' }], [], '2026-10-25');
  assert.equal(isoWeekday(r.from), 1);
  assert.ok(r.from <= '2026-10-25' && daysBetween(r.from, '2026-11-16') < r.days);
});
