import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanState, scanPollMs, SCAN_LATE_MS } from './scanState.js';

test('a scan request is none, waiting, then late', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  assert.equal(scanState(null, now), 'none');
  assert.equal(scanState({ scanRequestedAt: null }, now), 'none');
  assert.equal(scanState({ scanRequestedAt: new Date(now - 60 * 1000).toISOString() }, now), 'waiting');
  assert.equal(scanState({ scanRequestedAt: new Date(now - SCAN_LATE_MS - 1000).toISOString() }, now), 'late');
});

test('pages poll only while a scan is waiting', () => {
  assert.equal(scanPollMs({ scanRequestedAt: new Date().toISOString() }), 20000);
  assert.equal(scanPollMs({ scanRequestedAt: null }), null);
  assert.equal(scanPollMs({ scanRequestedAt: '2020-01-01T00:00:00Z' }), null);
});
