import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex, childrenOf, pathIds, isEffectivelyActive, pathLabel, asksApp,
} from './categoryTree.js';

// Hardware(1) › Laptop(2) › Battery(3); Hardware › Printer(4, retired) › Toner(5); Software(6), Access(7).
const cats = [
  { id: 1, parentId: null, name: 'Hardware', sortOrder: 2, active: true },
  { id: 2, parentId: 1, name: 'Laptop', sortOrder: 1, active: true },
  { id: 3, parentId: 2, name: 'Battery', sortOrder: 0, active: true },
  { id: 4, parentId: 1, name: 'Printer', sortOrder: 0, active: false },
  { id: 5, parentId: 4, name: 'Toner', sortOrder: 0, active: true },
  { id: 6, parentId: null, name: 'Software', sortOrder: 0, active: true },
  { id: 7, parentId: null, name: 'Access', sortOrder: 0, active: true },
];

test('childrenOf orders by sortOrder then name and skips retired', () => {
  const idx = buildIndex(cats);
  assert.deepEqual(childrenOf(idx, null).map((c) => c.name), ['Access', 'Software', 'Hardware']);
  assert.deepEqual(childrenOf(idx, 1).map((c) => c.name), ['Laptop']);
  assert.deepEqual(childrenOf(idx, 1, { includeRetired: true }).map((c) => c.name), ['Printer', 'Laptop']);
});

test('pathIds root→leaf; [] for unknown or empty', () => {
  const idx = buildIndex(cats);
  assert.deepEqual(pathIds(idx, 3), [1, 2, 3]);
  assert.deepEqual(pathIds(idx, 99), []);
  assert.deepEqual(pathIds(idx, null), []);
  assert.deepEqual(pathIds(idx, '3'), [1, 2, 3]);
});

test('isEffectivelyActive false under a retired ancestor', () => {
  const idx = buildIndex(cats);
  assert.equal(isEffectivelyActive(idx, 3), true);
  assert.equal(isEffectivelyActive(idx, 4), false);
  assert.equal(isEffectivelyActive(idx, 5), false);
  assert.equal(isEffectivelyActive(idx, 99), false);
});

test('pathLabel joins names', () => {
  const idx = buildIndex(cats);
  assert.equal(pathLabel(idx, 3), 'Hardware › Laptop › Battery');
  assert.equal(pathLabel(idx, null), '');
});

test('asksApp: a category asks which app when it, or one above it, says so (9)', () => {
  const index = buildIndex([
    { id: 1, parentId: null, name: 'Software', active: true, pickKind: 'software' },
    { id: 2, parentId: 1, name: 'Crashes', active: true, pickKind: null },
    { id: 3, parentId: null, name: 'Network', active: true },
  ]);
  assert.equal(asksApp(index, 1), 'software');
  assert.equal(asksApp(index, 2), 'software');
  assert.equal(asksApp(index, 3), null);
  assert.equal(asksApp(index, null), null);
  assert.equal(asksApp(index, 99), null);
});
