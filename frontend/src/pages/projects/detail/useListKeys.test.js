import test from 'node:test';
import assert from 'node:assert/strict';
import { nextIndex } from './useListKeys.js';

test('nextIndex clamps at both ends', () => {
  assert.equal(nextIndex(0, -1, 5), 0);
  assert.equal(nextIndex(4, 1, 5), 4);
  assert.equal(nextIndex(2, 1, 5), 3);
  assert.equal(nextIndex(2, -1, 5), 1);
});

test('nextIndex with nothing selected starts at the first row', () => {
  assert.equal(nextIndex(-1, 1, 5), 0);
  assert.equal(nextIndex(-1, -1, 5), 0);
});

test('nextIndex on an empty list is -1', () => {
  assert.equal(nextIndex(-1, 1, 0), -1);
});
