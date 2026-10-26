import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { presetRange } from './presets.js';
import { setOrgTimeZone } from '../../utils/orgDate.js';

// Sunday 1 Nov 2026, 21:30 in Chicago: already Monday 2 Nov in UTC. The
// presets must follow the organization's calendar, whatever the browser's
// zone or the UTC date says.
const at = (iso, zone, fn) => {
  mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
  setOrgTimeZone(zone);
  try { fn(); } finally { mock.timers.reset(); setOrgTimeZone('UTC'); }
};

test('a Chicago evening counts from the Chicago date, not the UTC one', () => {
  at('2026-11-02T03:30:00Z', 'America/Chicago', () => {
    assert.deepEqual(presetRange('today'), { startDate: '2026-11-01', endDate: '2026-11-01' });
    assert.deepEqual(presetRange('this_week'), { startDate: '2026-10-26', endDate: '2026-11-01' });
    assert.deepEqual(presetRange('this_month'), { startDate: '2026-11-01', endDate: '2026-11-01' });
    assert.deepEqual(presetRange('last_month'), { startDate: '2026-10-01', endDate: '2026-10-31' });
    assert.deepEqual(presetRange('this_year'), { startDate: '2026-01-01', endDate: '2026-11-01' });
  });
});

test('east of UTC the first of the month stays the first (the old toISOString slip)', () => {
  at('2026-11-02T03:30:00Z', 'Asia/Tokyo', () => {
    assert.deepEqual(presetRange('this_month'), { startDate: '2026-11-01', endDate: '2026-11-02' });
    assert.deepEqual(presetRange('this_week'), { startDate: '2026-11-02', endDate: '2026-11-02' });
    assert.deepEqual(presetRange('last_3_months'), { startDate: '2026-08-02', endDate: '2026-11-02' });
  });
});

test('custom and unknown presets have no range', () => {
  assert.equal(presetRange('custom'), null);
});
