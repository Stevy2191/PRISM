import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionFieldsFor, describeCondition, earlierItems, newKey } from './conditions.js';

const sections = [
  { key: 'a', title: 'A', items: [{ key: 'leaving', kind: 'field', fieldType: 'yesno', label: 'Leaving?' }, { key: 'note', kind: 'text', body: '<p>Hi</p>' }] },
  { key: 'b', title: 'B', items: [{ key: 'wipe', kind: 'step', body: '<p>Wipe <b>it</b></p>' }, { key: 'cond', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['Good', 'Bad'] }] },
];

test('only items before the point count as earlier answers', () => {
  assert.deepEqual(earlierItems(sections, { s: 1, i: 1 }).map((i) => i.key), ['leaving', 'note', 'wipe']);
  assert.deepEqual(earlierItems(sections, { s: 1, i: null }).map((i) => i.key), ['leaving', 'note']);
  assert.deepEqual(earlierItems(sections, { s: 0, i: 0 }), []);
});

test('device fields only on forms used per device; answers carry their choices', () => {
  const lookups = { mdms: [{ id: 5, name: 'MDM A' }] };
  const device = conditionFieldsFor({ sections, at: { s: 1, i: 1 }, usage: 'device', lookups });
  assert.ok(device.some((f) => f.on === 'device' && f.field === 'mdmId'));
  const ticket = conditionFieldsFor({ sections, at: { s: 1, i: 1 }, usage: 'ticket', lookups });
  assert.ok(!ticket.some((f) => f.on === 'device'));
  const leaving = ticket.find((f) => f.field === 'leaving');
  assert.deepEqual(leaving.choices.map((c) => c.value), [true, false]);
  assert.equal(ticket.find((f) => f.field === 'wipe').label, 'Step: Wipe it');
  assert.ok(!ticket.some((f) => f.field === 'note')); // text isn't an answer
});

test('describes a condition with names, not ids', () => {
  const fields = conditionFieldsFor({ sections, at: { s: 1, i: 1 }, usage: 'device', lookups: { mdms: [{ id: 5, name: 'MDM A' }] } });
  assert.equal(describeCondition({ on: 'device', field: 'mdmId', op: 'is', value: 5 }, fields), 'MDM is MDM A');
  assert.equal(describeCondition({ on: 'answer', field: 'leaving', op: 'is', value: true }, fields), 'Leaving? is Yes');
  assert.equal(describeCondition({ on: 'person', field: 'departmentId', op: 'is_empty' }, fields), 'Person department is empty');
});

test('new keys are valid and different', () => {
  const a = newKey('step');
  assert.match(a, /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/);
  assert.notEqual(a, newKey('step'));
});
