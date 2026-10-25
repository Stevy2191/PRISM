import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterLevel, meterPercent } from './meter.js';

test('meterLevel null budget is none', () => {
  assert.equal(meterLevel(50, null), 'none');
  assert.equal(meterLevel(50, undefined), 'none');
  assert.equal(meterLevel(50, 0), 'none');
});

test('79.9% is ok, 80% is near, 100% is near, 100.1% is over', () => {
  assert.equal(meterLevel(79.9, 100), 'ok');
  assert.equal(meterLevel(80, 100), 'near');
  assert.equal(meterLevel(100, 100), 'near');
  assert.equal(meterLevel(100.1, 100), 'over');
  assert.equal(meterLevel(0, 100), 'ok');
});

test('meterPercent clamps the bar fill to 0-100', () => {
  assert.equal(meterPercent(50, 100), 50);
  assert.equal(meterPercent(250, 100), 100);
  assert.equal(meterPercent(5, null), 0);
});
