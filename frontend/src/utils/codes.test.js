import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestCode, cleanCode } from './codes.js';

test('suggests codes like the server', () => {
  assert.equal(suggestCode('Washington County'), 'WC');
  assert.equal(suggestCode('Harbor Law Group'), 'HLG');
  assert.equal(suggestCode('Human Resources', { single: 3 }), 'HR');
  assert.equal(suggestCode('Finance', { single: 3 }), 'FIN');
  assert.equal(suggestCode("Sheriff's Office"), 'SO');
  assert.equal(cleanCode('w-c 1'), 'WC1');
});
