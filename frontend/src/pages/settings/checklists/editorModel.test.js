import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  toEditor, fromEditor, readConditions, writeConditions, describeOnlyFor, setFinish, finishChoice,
  indentLine, outdentLine, flipBranch, setOnlyFor, setAdvanced, updateItem, insertLine, removeLine, moveLine,
  bodyToText, textToBody, turnInto,
} from './editorModel.js';

const require = createRequire(import.meta.url);
const { FORMS } = require('../../../../../backend/src/services/playbooks/starters.js');
const fixtures = new URL('../../../../../backend/test/fixtures/playbooks/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(name, fixtures)), 'utf8')).forms[0].definition;

// The Apple fixtures name MDMs and types ({ $ref, name }); give them ids, as
// a form stored in this install has.
const ids = { ManageEngine: 1, 'Jamf Pro': 2, Mac: 10, iPhone: 11, iPad: 12 };
const stored = (def) => JSON.parse(JSON.stringify(def), (k, v) => (v && typeof v === 'object' && v.$ref ? ids[v.name] : v));

const advanced = {
  sections: [{
    key: 's',
    title: 'Mixed',
    showWhen: [{ on: 'person', field: 'departmentId', op: 'is', value: 4 }],
    items: [
      { key: 'q', kind: 'field', fieldType: 'yesno', label: 'Leaving?', required: true },
      { key: 'a', kind: 'step', body: '<p>Agent present</p>', required: true, showWhen: [{ on: 'device', field: 'hasAgent', op: 'is', value: true }] },
      { key: 'b', kind: 'step', body: '<p>Two answers</p>', required: false, showWhen: [{ on: 'answer', field: 'q', op: 'is', value: true }, { on: 'answer', field: 'q', op: 'is_not_empty' }] },
      { key: 'c', kind: 'step', body: '<p>Order kept</p>', required: true, showWhen: [{ on: 'device', field: 'categoryId', op: 'in', value: [10] }, { on: 'answer', field: 'q', op: 'is', value: false }] },
      { key: 'd', kind: 'text', body: '<ul><li>rich</li></ul>', required: false },
      { key: 'in', kind: 'action', action: 'check_in', statuses: ['on_hold'], required: true },
    ],
  }],
};

test('opening and saving without changes gives back the stored definition', () => {
  const all = [
    ...FORMS.map((f) => [f.name, f.definition]),
    ['Apple check-in', stored(fixture('apple-check-in.json'))],
    ['Apple check-out', stored(fixture('apple-check-out.json'))],
    ['Advanced', advanced],
  ];
  assert.ok(all.length >= 6);
  for (const [name, def] of all) assert.deepEqual(fromEditor(toEditor(def)), def, name);
});

test('the finish step comes off the lines and goes back last', () => {
  const model = toEditor(advanced);
  assert.deepEqual(model.finish, { key: 'in', kind: 'action', action: 'check_in', statuses: ['on_hold'], required: true });
  assert.ok(!model.sections[0].lines.some((l) => l.item.kind === 'action'));
  assert.equal(finishChoice(model), 'check_in');
  assert.equal(setFinish(model, 'check_in'), model); // unchanged choice keeps its statuses
  const out = setFinish(model, 'check_out');
  assert.deepEqual(out.finish, { key: 'check_out', kind: 'action', action: 'check_out', required: true });
  const none = setFinish(model, 'nothing');
  assert.ok(!fromEditor(none).sections[0].items.some((i) => i.kind === 'action'));
  assert.deepEqual(setFinish(none, 'check_in').finish.statuses, ['ready_to_issue', 'in_repair', 'on_hold']);
});

test('Only for chips ↔ device conditions', () => {
  assert.deepEqual(readConditions([{ on: 'device', field: 'mdm', op: 'in', value: [2, 'none'] }, { on: 'device', field: 'categoryId', op: 'in', value: [10] }]),
    { onlyFor: { mdm: [2, 'none'], categoryId: [10] }, indent: null, advanced: false });
  assert.deepEqual(readConditions([{ on: 'device', field: 'mdmId', op: 'is', value: 2 }]).onlyFor, { mdm: [2], categoryId: [] });
  assert.deepEqual(writeConditions({ onlyFor: { mdm: [2, 'none'], categoryId: [10, 11] } }), [
    { on: 'device', field: 'mdm', op: 'in', value: [2, 'none'] },
    { on: 'device', field: 'categoryId', op: 'in', value: [10, 11] },
  ]);
  assert.equal(writeConditions({ onlyFor: { mdm: [], categoryId: [] } }), undefined);
  const lookups = { mdms: [{ id: 2, name: 'Jamf Pro' }], categories: [{ id: 10, name: 'Mac' }, { id: 12, name: 'iPad' }] };
  assert.equal(describeOnlyFor({ mdm: [2], categoryId: [10] }, lookups), 'Shows for Macs on Jamf Pro');
  assert.equal(describeOnlyFor({ mdm: [2, 'none'], categoryId: [10, 12] }, lookups), 'Shows for Macs and iPads on Jamf Pro or not managed');
  assert.equal(describeOnlyFor({ mdm: ['none'], categoryId: [] }, lookups), 'Shows for devices that are not managed');
  assert.equal(describeOnlyFor(null, lookups), 'Shows for every device');
});

test('choosing Only for writes mdm in / categoryId in', () => {
  let m = toEditor({ sections: [{ key: 's', title: 'S', items: [{ key: 'a', kind: 'step', body: '<p>A</p>', required: true }] }] });
  m = setOnlyFor(m, 0, 0, { mdm: [2, 'none'], categoryId: [] });
  assert.deepEqual(fromEditor(m).sections[0].items[0].showWhen, [{ on: 'device', field: 'mdm', op: 'in', value: [2, 'none'] }]);
  m = setOnlyFor(m, 0, 0, { mdm: [], categoryId: [] });
  assert.equal(fromEditor(m).sections[0].items[0].showWhen, undefined);
  m = setOnlyFor(m, 0, null, { mdm: [], categoryId: [10] });
  assert.deepEqual(fromEditor(m).sections[0].showWhen, [{ on: 'device', field: 'categoryId', op: 'in', value: [10] }]);
});

const qa = () => toEditor({
  sections: [{
    key: 's',
    title: 'S',
    items: [
      { key: 'q', kind: 'field', fieldType: 'yesno', label: 'Leaving?', required: true },
      { key: 'a', kind: 'step', body: '<p>A</p>', required: true },
      { key: 'b', kind: 'step', body: '<p>B</p>', required: true },
    ],
  }],
});

test('indenting under a yes/no question stores an answer condition; "If no" is false', () => {
  let m = indentLine(qa(), 0, 1);
  m = flipBranch(m, 0, 1);
  m = indentLine(m, 0, 2); // follows the line above into "If no"
  const items = fromEditor(m).sections[0].items;
  assert.deepEqual(items[1].showWhen, [{ on: 'answer', field: 'q', op: 'is', value: false }]);
  assert.deepEqual(items[2].showWhen, [{ on: 'answer', field: 'q', op: 'is', value: false }]);
  m = outdentLine(m, 0, 2);
  assert.equal(fromEditor(m).sections[0].items[2].showWhen, undefined);
  // Reading it back shows the indent.
  assert.deepEqual(toEditor(fromEditor(m)).sections[0].lines[1].indent, { question: 'q', value: false });
});

test('indenting needs a question above, and Only for and indenting combine', () => {
  const m = qa();
  assert.equal(indentLine(m, 0, 0), m); // the question itself
  const noQuestion = toEditor({ sections: [{ key: 's', title: 'S', items: [{ key: 'a', kind: 'step', body: '<p>A</p>' }, { key: 'b', kind: 'step', body: '<p>B</p>' }] }] });
  assert.equal(indentLine(noQuestion, 0, 1), noQuestion);
  const both = setOnlyFor(indentLine(m, 0, 1), 0, 1, { mdm: [2], categoryId: [] });
  assert.deepEqual(fromEditor(both).sections[0].items[1].showWhen, [
    { on: 'answer', field: 'q', op: 'is', value: true },
    { on: 'device', field: 'mdm', op: 'in', value: [2] },
  ]);
});

test('a line with other conditions is advanced and left alone', () => {
  const m = toEditor(advanced);
  const [q, a, b, c, d] = m.sections[0].lines;
  assert.equal(m.sections[0].advanced, true);
  assert.deepEqual([q.advanced, a.advanced, b.advanced, c.advanced, d.advanced], [false, true, true, false, false]);
  assert.deepEqual(c.indent, { question: 'q', value: false }); // chips + indent, in their stored order
  assert.equal(indentLine(m, 0, 1), m);
  assert.equal(outdentLine(m, 0, 1), m);
  // Clearing the advanced rules gives the line its chips back.
  const cleared = setAdvanced(m, 0, 1, []);
  assert.equal(cleared.sections[0].lines[1].advanced, false);
  assert.equal(fromEditor(cleared).sections[0].items[1].showWhen, undefined);
  const chips = setAdvanced(m, 0, 1, [{ on: 'device', field: 'mdm', op: 'in', value: [2] }]);
  assert.deepEqual(chips.sections[0].lines[1].onlyFor, { mdm: [2], categoryId: [] });
});

test('lines indented under a question lose it when the question goes', () => {
  let m = indentLine(indentLine(qa(), 0, 1), 0, 2);
  m = removeLine(m, 0, 0);
  assert.ok(fromEditor(m).sections[0].items.every((i) => !i.showWhen));
  let n = indentLine(qa(), 0, 1);
  n = updateItem(n, 0, 0, { fieldType: 'text' });
  assert.equal(fromEditor(n).sections[0].items[1].showWhen, undefined);
  let o = indentLine(qa(), 0, 1);
  o = moveLine(o, 0, 1, -1); // above its question
  assert.equal(fromEditor(o).sections[0].items[0].showWhen, undefined);
});

test('a new line joins the group of the line above it', () => {
  const m = insertLine(indentLine(qa(), 0, 1), 0, 2, { key: 'n', kind: 'step', body: '<p>New</p>', required: true });
  assert.deepEqual(fromEditor(m).sections[0].items[2].showWhen, [{ on: 'answer', field: 'q', op: 'is', value: true }]);
  const under = insertLine(qa(), 0, 1, { key: 'n', kind: 'step', body: '<p>New</p>', required: true });
  assert.deepEqual(under.sections[0].lines[1].indent, { question: 'q', value: true });
});

test('line text: bold survives, anything richer opens the rich editor', () => {
  assert.equal(bodyToText('<p>Keep the <b>serial</b> &amp; tag</p>'), 'Keep the **serial** & tag');
  assert.equal(textToBody('Keep the **serial** & <tag>'), '<p>Keep the <b>serial</b> &amp; &lt;tag&gt;</p>');
  assert.equal(bodyToText('<ul><li>x</li></ul>'), null);
  assert.equal(bodyToText('<p>a</p><p>b</p>'), null);
});

test('Turn into keeps the words', () => {
  const step = { key: 'k', kind: 'step', body: '<p>Is it on <b>hold</b>?</p>', required: true };
  assert.deepEqual(turnInto(step, 'field', { fieldType: 'yesno' }), { key: 'k', kind: 'field', label: 'Is it on hold?', fieldType: 'yesno', required: true });
  assert.deepEqual(turnInto(step, 'secure'), { key: 'k', kind: 'secure', label: 'Is it on hold?', required: true });
  assert.deepEqual(turnInto({ key: 'k', kind: 'secure', label: 'Code', required: true }, 'text'), { key: 'k', kind: 'text', body: '<p>Code</p>', required: false });
  assert.deepEqual(turnInto(step, 'field', { fieldType: 'choice' }).options, ['Yes', 'No']);
});
