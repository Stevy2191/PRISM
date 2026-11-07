import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseChecklist, describeSummary } from './parseChecklist.js';

const mdms = [{ id: 1, name: 'ManageEngine' }, { id: 2, name: 'Jamf Pro' }];
const categories = [{ id: 10, name: 'Mac' }, { id: 11, name: 'iPhone' }, { id: 12, name: 'iPad' }];
const device = (text, extra = {}) => parseChecklist(text, {
  name: 'Test', usage: 'device', mdms, categories, ...extra,
}).definition;
const items = (def) => def.sections.flatMap((s) => s.items);
const only = (item) => Object.fromEntries((item.showWhen || []).map((c) => [c.field, c.value]));

test('bullets and boxes are stripped; each line is a required step', () => {
  const def = device('Wipe\n- One\n* Two\n• Three\n☐ Four\n[ ] Five\n- [ ] Six\n1. Seven\n2) Eight');
  assert.deepEqual(items(def).map((i) => i.body), ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'].map((t) => `<p>${t}</p>`));
  assert.ok(items(def).every((i) => i.kind === 'step' && i.required));
  assert.equal(def.sections[0].title, 'Wipe');
});

test('sections: #, Step n, or a short line over other lines; lines before go under the name', () => {
  const def = device('Intro line.\n# Prepare\n- a\nStep 2: Wipe it\n- b\nFinish up\n- c');
  assert.deepEqual(def.sections.map((s) => s.title), ['Test', 'Prepare', 'Step 2: Wipe it', 'Finish up']);
  // A run of short lines without bullets is a list of steps, not headings.
  const plain = device('Before\nCharge it\nLabel it\nShelve it');
  assert.deepEqual(plain.sections.map((s) => s.title), ['Before']);
  assert.equal(items(plain).length, 3);
  // A first line that is the checklist's name is dropped.
  assert.deepEqual(device('Test\n\nPrepare\n- a').sections.map((s) => s.title), ['Prepare']);
});

test('when bullets are used, lines without one are notes', () => {
  const def = device('Wipe\nRead this first.\n- Do it');
  assert.deepEqual(items(def).map((i) => [i.kind, i.required]), [['text', false], ['step', true]]);
});

test('a line ending with ":" is something to write down; a password or code is hidden', () => {
  const def = device('Record\nSerial number:\nBypass code:\nTemporary password:\nPIN:');
  assert.deepEqual(items(def).map((i) => [i.kind, i.label]), [
    ['field', 'Serial number'], ['secure', 'Bypass code'], ['secure', 'Temporary password'], ['secure', 'PIN'],
  ]);
  assert.equal(items(def)[0].fieldType, 'text');
  // Over bulleted lines it's a label instead.
  const label = device('Clean up\nEntra:\n- Delete the record');
  assert.deepEqual(items(label).map((i) => i.kind), ['text', 'step']);
});

test('Only for: MDM and device type prefixes', () => {
  const def = device([
    'Wipe',
    'Jamf Pro: Wipe Computer',
    'Mac only: Create the local account',
    'iPhone/iPad: Sign in',
    'If ManageEngine (Mac): Complete Wipe',
    'Not managed: Erase it by hand',
    'Jamf Pro or not managed: Either',
    'Note: not a name',
  ].join('\n'));
  const [jamf, mac, phones, meMac, none, either, note] = items(def);
  assert.deepEqual(only(jamf), { mdm: [2] });
  assert.equal(jamf.body, '<p>Wipe Computer</p>');
  assert.deepEqual(only(mac), { categoryId: [10] });
  assert.deepEqual(only(phones), { categoryId: [11, 12] });
  assert.deepEqual(only(meMac), { mdm: [1], categoryId: [10] });
  assert.deepEqual(only(none), { mdm: ['none'] });
  assert.deepEqual(only(either), { mdm: [2, 'none'] });
  assert.equal(note.showWhen, undefined);
  assert.equal(note.body, '<p>Note: not a name</p>');
});

test('an "If Jamf Pro:" line applies to the lines under it, until "Both:", a note or a blank line', () => {
  const def = device('Wipe\nIf Jamf Pro:\n- Open the record\n- Mac: Wipe Computer\nBoth:\n- Wait\nIf ManageEngine:\n- Complete Wipe\n\n- After');
  const [open, mac, wait, me, after] = items(def);
  assert.deepEqual(only(open), { mdm: [2] });
  assert.deepEqual(only(mac), { mdm: [2], categoryId: [10] });
  assert.equal(wait.showWhen, undefined);
  assert.deepEqual(only(me), { mdm: [1] });
  assert.equal(after.showWhen, undefined);
});

test('a ticket checklist never gets Only for', () => {
  const def = parseChecklist('Jamf Pro: Wipe', { name: 'T', usage: 'ticket', mdms, categories }).definition;
  assert.equal(items(def)[0].showWhen, undefined);
  assert.equal(items(def)[0].body, '<p>Jamf Pro: Wipe</p>');
});

test('questions, optional steps and bold', () => {
  const def = device('Check\nIs it under legal hold?\nIdeally, the user is present.\nLabel it (optional)\nKeep the **serial number**.');
  const [q, ideally, label, bold] = items(def);
  assert.deepEqual([q.kind, q.fieldType, q.label, q.required], ['field', 'yesno', 'Is it under legal hold?', true]);
  assert.equal(ideally.required, false);
  assert.deepEqual([label.body, label.required], ['<p>Label it</p>', false]);
  assert.equal(bold.body, '<p>Keep the <b>serial number</b>.</p>');
});

test('everything else is escaped', () => {
  const def = device('Steps\n<script>alert(1)</script> & "more"');
  assert.equal(items(def)[0].body, '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;</p>');
});

test('When it\'s finished adds the device action last', () => {
  const out = device('Steps\n- Wipe', { finish: 'check_in' });
  assert.deepEqual(items(out).slice(-1)[0], {
    key: 'check_in', kind: 'action', action: 'check_in', statuses: ['ready_to_issue', 'in_repair', 'on_hold'], required: true,
  });
  assert.equal(items(device('Steps\n- Set up', { finish: 'check_out' })).slice(-1)[0].action, 'check_out');
  assert.ok(!items(device('Steps\n- Set up')).some((i) => i.kind === 'action'));
});

test('keys are readable, unique and what the server accepts', () => {
  const def = device('Wipe\n- Wipe it\n- Wipe it\n- ???');
  const keys = [def.sections[0].key, ...items(def).map((i) => i.key)];
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((k) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(k)));
});

test('the summary', () => {
  const { summary } = parseChecklist('Record\n- Wipe\nSerial:\nCode:', { name: 'T', usage: 'device', mdms, categories });
  assert.deepEqual(summary, { sections: 1, steps: 1, fields: 1, secrets: 1, onlyFor: 0 });
  assert.equal(describeSummary({ sections: 9, steps: 31, fields: 5, secrets: 1 }), '9 sections, 31 steps, 5 things to write down, 1 password/code');
});

// ---- The owner's two documents, against the acceptance fixtures ------------------

const fixtures = new URL('../../../../../backend/test/fixtures/playbooks/', import.meta.url);
const read = (name) => readFileSync(fileURLToPath(new URL(name, fixtures)), 'utf8');
const names = { 1: 'ManageEngine', 2: 'Jamf Pro', 10: 'Mac', 11: 'iPhone', 12: 'iPad' };

// "Section › ManageEngine + Mac" for every item limited only by device; the
// fixtures name MDMs and types ({ $ref, name }), the parse uses ids.
function chips(sections, fromFixture) {
  const label = (v) => (fromFixture ? v.name : names[v]);
  return sections.flatMap((s) => s.items.filter((i) => i.showWhen && i.showWhen.every((c) => c.on === 'device')).map((i) => {
    const parts = i.showWhen.flatMap((c) => [].concat(c.value).map(label));
    return `${s.title} › ${parts.join(' + ')}`;
  }));
}

function compare(text, fixture, finish, expectedMissing) {
  const form = JSON.parse(read(fixture)).forms[0];
  const { definition } = parseChecklist(read(text), {
    name: form.name, usage: 'device', finish, mdms, categories,
  });
  // A named difference: the introduction lands in a first section of notes,
  // named after the checklist, for a person to delete or keep.
  const [intro, ...rest] = definition.sections;
  assert.equal(intro.title, form.name);
  assert.ok(intro.items.every((i) => i.kind === 'text'));
  assert.deepEqual(rest.map((s) => s.title), form.definition.sections.map((s) => s.title));

  const parsed = chips(rest, false);
  const wanted = chips(form.definition.sections, true);
  // Everything the parse limits, the fixture limits the same way...
  const left = [...wanted];
  for (const c of parsed) {
    const at = left.indexOf(c);
    assert.notEqual(at, -1, `unexpected Only for: ${c}`);
    left.splice(at, 1);
  }
  // ...and what it misses is where the document puts both on one line.
  assert.deepEqual(left, expectedMissing);
  assert.equal(items(definition).slice(-1)[0].action, finish);
}

test('the check-in document gives the fixture\'s sections and Only for chips', () => {
  compare('apple-check-in.txt', 'apple-check-in.json', 'check_in', [
    // "Find the device in the MDM: ManageEngine: … Jamf Pro: …" is one line.
    'Step 1: Receive the device and find its records › ManageEngine',
    'Step 1: Receive the device and find its records › Jamf Pro',
    // "(Jamf Pro: Inventory > Security; ManageEngine: device details)" is one line.
    'Step 2: Check Activation Lock and sign out of Apple Accounts › ManageEngine',
    'Step 2: Check Activation Lock and sign out of Apple Accounts › Jamf Pro',
    // "Mac: System Settings > [name]; iPhone/iPad: Settings > [name]" is one line.
    'Step 2: Check Activation Lock and sign out of Apple Accounts › Mac',
    'Step 2: Check Activation Lock and sign out of Apple Accounts › iPhone + iPad',
    // "Older Intel Macs ask for a 6-digit passcode" has no prefix (and is a
    // hidden code in the fixture).
    'Step 5: Wipe the device from the MDM › Mac',
  ]);
});

test('the check-out document gives every one of the fixture\'s Only for chips', () => {
  compare('apple-check-out.txt', 'apple-check-out.json', 'check_out', []);
});
