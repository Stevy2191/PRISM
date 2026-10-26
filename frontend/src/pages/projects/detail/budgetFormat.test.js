import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, hoursInput, barShape } from './budgetFormat.js';

test('parseHours reads hours in the usual spellings', () => {
  assert.equal(parseHours('80'), 4800);
  assert.equal(parseHours(' 80 h '), 4800);
  assert.equal(parseHours('7.5 hours'), 450);
  assert.equal(parseHours('1,5'), 90);
  assert.equal(parseHours(''), null);
  assert.equal(parseHours(null), null);
  assert.equal(parseHours('0'), 0);
});

test('parseHours refuses nonsense and huge numbers', () => {
  for (const bad of ['abc', '-2', '1e3', '1.2.3', '200000']) assert.ok(Number.isNaN(parseHours(bad)), bad);
});

test('hoursInput', () => {
  assert.equal(hoursInput(4800), '80');
  assert.equal(hoursInput(450), '7.5');
  assert.equal(hoursInput(null), '');
});

test('barShape puts the budget at half the track', () => {
  assert.deepEqual(barShape(570, 600, 0), { width: 47.5, mark: 50 });
  assert.deepEqual(barShape(2000, 600, 0), { width: 100, mark: 50 });
  assert.deepEqual(barShape(30, null, 60), { width: 50, mark: null });
});
