import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBarValue } from './chartFormat.js';

test('whole numbers print as they are, with thousands separators', () => {
  assert.equal(formatBarValue(7), '7');
  assert.equal(formatBarValue(12500), '12,500');
});

test('fractions are rounded to one decimal (no float noise)', () => {
  assert.equal(formatBarValue(18.449999999), '18.4');
  assert.equal(formatBarValue(0.1 + 0.2), '0.3');
});

test('cost bars show whole dollars', () => {
  assert.equal(formatBarValue(1234.5600000000001, 'cost'), '$1,235');
});

test('empty values print nothing', () => {
  assert.equal(formatBarValue(null), '');
  assert.equal(formatBarValue(undefined), '');
});
