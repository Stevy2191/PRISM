const Sequelize = require('sequelize');
const {
  resetData, closeDb, sequelize, models,
} = require('./helpers');
const { makeWorld } = require('./fixtures');
const migration = require('../../migrations/20260101000081-playbook-starters');
const { FORMS, PLAYBOOKS } = require('../../src/services/playbooks/starters');
const { validateDefinition } = require('../../src/services/playbooks/formDefinition');

// Sub-project PB, task 10: vendor-neutral starter forms and playbooks.

const qi = () => sequelize.getQueryInterface();

beforeEach(async () => {
  await resetData(); // empties Forms and Playbooks
  await makeWorld();
});
afterAll(closeDb);

it('every starter passes the same checks as a form saved in Settings', () => {
  for (const f of FORMS) expect(() => validateDefinition(f.definition, { usage: f.usage })).not.toThrow();
  expect(FORMS.map((f) => f.name)).toEqual(['Device check-out', 'Device check-in', 'New account', 'Account termination']);
});

it('names no MDM, carrier, vendor or product', () => {
  const text = JSON.stringify({ FORMS, PLAYBOOKS }).toLowerCase();
  const names = ['apple', 'jamf', 'manageengine', 'intune', 'kandji', 'mosyle', 'microsoft', 'google', 'verizon', 'at&t', 't-mobile',
    'dell', ' hp ', 'lenovo', 'iphone', 'ipad', 'mac ', 'macbook', 'windows', 'entra', 'active directory', 'office 365', 'workspace'];
  for (const name of names) expect(text).not.toContain(name);
});

it('seeds into an install with no forms, once; leaves an install with forms alone', async () => {
  await migration.up(qi(), Sequelize);
  const forms = await models.Form.findAll({ include: ['currentVersion'], order: [['id', 'ASC']] });
  expect(forms.map((f) => [f.name, f.usage, f.isActive, f.currentVersion.version])).toEqual([
    ['Device check-out', 'device', true, 1], ['Device check-in', 'device', true, 1], ['New account', 'ticket', true, 1], ['Account termination', 'ticket', true, 1],
  ]);
  const playbooks = await models.Playbook.findAll({ order: [['position', 'ASC']] });
  expect(playbooks.map((p) => [p.name, p.needsPerson, p.blocks.map((b) => b.applies)])).toEqual([
    ['New account', false, ['once', 'ticket_devices']], ['Account termination', true, ['once', 'person_devices']],
  ]);
  await migration.up(qi(), Sequelize); // forms exist now: nothing more
  expect(await models.Form.count()).toBe(4);
});

it('down removes only starters nobody has changed', async () => {
  await migration.up(qi(), Sequelize);
  const checkIn = await models.Form.findOne({ where: { name: 'Device check-in' } });
  await models.FormVersion.create({ formId: checkIn.id, version: 2, definition: { sections: [] } });
  await migration.down(qi(), Sequelize);
  expect((await models.Form.findAll()).map((f) => f.name)).toEqual(['Device check-in']);
  expect(await models.Playbook.count()).toBe(0);
});
