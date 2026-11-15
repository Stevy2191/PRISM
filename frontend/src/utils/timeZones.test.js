import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIME_ZONES, zoneOptions } from './timeZones.js';

test('every zone is one this runtime knows, listed once', () => {
  assert.equal(new Set(TIME_ZONES).size, TIME_ZONES.length);
  for (const tz of TIME_ZONES) assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: tz }), tz);
});

test('a saved zone that is not on the list is still offered, first', () => {
  assert.deepEqual(zoneOptions('Asia/Kathmandu').slice(0, 2), ['Asia/Kathmandu', 'UTC']);
  assert.equal(zoneOptions('UTC'), TIME_ZONES);
  assert.equal(zoneOptions(''), TIME_ZONES);
});
