const crypto = require('crypto');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { applyInventory } = require('../../src/services/agent/inventory');

// Sub-project PB, task 7: filling in ticket forms.

let w;
let company;
let jordan;
let ticket;
let mac;
let mdmA;
let mdmB;
let macs;

const definition = () => ({
  sections: [
    {
      key: 'start',
      title: 'Before you start',
      items: [
        { key: 'have', kind: 'step', body: 'You have the device', required: true },
        { key: 'serial', kind: 'field', fieldType: 'text', label: 'Serial number', required: true },
        { key: 'cond', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['Good', 'Damaged'] },
        { key: 'when', kind: 'field', fieldType: 'date', label: 'Received on' },
        { key: 'approver', kind: 'field', fieldType: 'contact', label: 'Who approved the wipe' },
      ],
    },
    {
      key: 'wipe',
      title: 'Wipe',
      items: [
        { key: 'wipe_a', kind: 'step', body: 'Wipe in MDM A', required: true, showWhen: [{ on: 'device', field: 'mdmId', op: 'is', value: mdmA.id }] },
        { key: 'wipe_b', kind: 'step', body: 'Wipe in MDM B', required: true, showWhen: [{ on: 'device', field: 'mdmId', op: 'is', value: mdmB.id }] },
        { key: 'leaving', kind: 'field', fieldType: 'yesno', label: 'Leaving?', required: true },
        { key: 'deactivate', kind: 'step', body: 'Deactivate', required: true, showWhen: [{ on: 'answer', field: 'leaving', op: 'is', value: true }] },
        { key: 'agent', kind: 'agent', body: 'PRISM agent reporting' },
      ],
    },
  ],
});

async function applyForm(def = definition(), { usage = 'device' } = {}) {
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({ name: 'Check-in', usage, definition: def }), 201).form;
  const playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Termination', needsPerson: true,
    blocks: usage === 'device' ? [{ formId: form.id, applies: 'person_devices' }] : [{ formId: form.id, applies: 'once' }],
  }), 201).playbook;
  const out = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id }), 201);
  return out.added.forms[0];
}
const url = (tf, rest = '') => `${API}/tickets/${ticket.id}/forms/${tf.id}${rest}`;
const answer = (tf, answers) => w.admin.agent.patch(url(tf)).send({ answers });

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  await models.AssetCategory.destroy({ where: { name: 'PB Macs' } });
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes', email: 'jreyes@county.example' });
  ticket = await makeTicket(w.admin.agent, { title: 'Termination: Jordan Reyes', contactId: jordan.id });
  mdmA = await models.Mdm.create({ name: 'MDM A', consoleUrl: 'https://a.example/d/{id}' });
  mdmB = await models.Mdm.create({ name: 'MDM B' });
  macs = await models.AssetCategory.create({ name: 'PB Macs' });
  mac = await models.Asset.create({
    assetTag: 'T-MAC', name: 'MacBook', categoryId: macs.id, companyId: company.id, assignedToContactId: jordan.id, isManaged: true, mdmId: mdmA.id, mdmDeviceId: '1487', serialNumber: 'C02X',
  });
});
afterAll(closeDb);

it('shows the form for its device: what shows, the device and the person', async () => {
  const tf = await applyForm();
  const { form } = expectOk(await w.admin.agent.get(url(tf)));
  expect(form.device).toMatchObject({ assetTag: 'T-MAC', mdm: { name: 'MDM A' }, mdmLink: 'https://a.example/d/1487' });
  expect(form.person).toMatchObject({ displayName: 'Jordan Reyes' });
  const shown = form.evaluation.sections.flatMap((s) => s.items).filter((i) => i.shown).map((i) => i.key);
  expect(shown).toContain('wipe_a');
  expect(shown).not.toContain('wipe_b');
  expect(form.evaluation).toMatchObject({ required: 4, done: 0, finished: false });
});

it('checks answers by kind', async () => {
  const tf = await applyForm();
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  const outsider = await makeContact(w.admin, { companyId: other.id });
  for (const bad of [
    { cond: 'Fine' }, { when: '2026-02-30' }, { leaving: 'yes' }, { approver: outsider.id }, { nope: 1 }, { serial: 42 },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    expect((await answer(tf, bad)).status).toBe(400);
  }
  const { form } = expectOk(await answer(tf, {
    have: true, serial: '  C02X  ', cond: 'Good', when: '2026-11-06', approver: jordan.id, leaving: false,
  }));
  expect(form.answers.serial).toBe('C02X');
  expect(form.answers.have).toMatchObject({ done: true, by: w.admin.user.id });
  // Unticking clears it.
  expect(expectOk(await answer(tf, { have: false })).form.answers.have).toBeUndefined();
});

it('finishing closes the task; it can\'t be closed by hand before, or deleted', async () => {
  const tf = await applyForm();
  const closed = await models.TaskStatus.findOne({ where: { scope: 'ticket', behaviorType: 'closed' } });
  const res = await w.admin.agent.patch(`${API}/tickets/${ticket.id}/tasks/${tf.task.id}`).send({ statusId: closed.id });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('FORM_OPEN');
  expect((await w.admin.agent.delete(`${API}/tickets/${ticket.id}/tasks/${tf.task.id}`)).status).toBe(409);

  // Leaving = no: deactivate is hidden, so not required.
  const { form } = expectOk(await answer(tf, { have: true, serial: 'C02X', wipe_a: true, leaving: false }));
  expect(form.state).toBe('finished');
  const task = await models.Task.findByPk(tf.task.id);
  expect(task.statusId).toBe(closed.id);
  expect(task.completedAt).toBeTruthy();
  // A finished form takes no more answers.
  expect((await answer(tf, { cond: 'Good' })).status).toBe(409);
  expect(await models.TicketActivity.count({ where: { ticketId: ticket.id, action: 'form_finished' } })).toBe(1);
});

it('a hidden step answered earlier is kept but ignored', async () => {
  const tf = await applyForm();
  expectOk(await answer(tf, { leaving: true, deactivate: true }));
  const { form } = expectOk(await answer(tf, { leaving: false }));
  expect(form.answers.deactivate).toBeTruthy();
  expect(form.evaluation.ignored).toEqual(['deactivate']);
});

it('skip needs a reason; not returned can mark the device lost', async () => {
  const tf = await applyForm();
  expect((await w.admin.agent.post(url(tf, '/skip')).send({ reason: ' ' })).status).toBe(400);
  const { form } = expectOk(await w.admin.agent.post(url(tf, '/skip')).send({ notReturned: true, markLost: true, reason: 'Left the state' }));
  expect(form).toMatchObject({ state: 'skipped', skipReason: 'Not returned: Left the state' });
  expect((await models.Asset.findByPk(mac.id)).status).toBe('lost');
  const task = await models.Task.findByPk(tf.task.id);
  expect(task.completedAt).toBeTruthy();
});

it('the PDF is there once the form is finished or skipped', async () => {
  const tf = await applyForm();
  expect((await w.admin.agent.get(url(tf, '/pdf'))).status).toBe(409);
  expectOk(await w.admin.agent.post(url(tf, '/skip')).send({ reason: 'Done elsewhere' }));
  const pdf = await w.admin.agent.get(url(tf, '/pdf')).buffer(true).parse((res, cb) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
  expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
});

it('agent steps tick themselves when the device reports in after the form was made', async () => {
  const publicKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  const { secret } = expectOk(await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'Key' }), 201);
  const res = await request(getApp()).post(`${API}/agent/v1/enroll`).send({
    enrollKey: secret, publicKey, platform: 'macos', arch: 'arm64', agentVersion: '0.5.0', hostname: 'MAC-1', serialNumber: 'C02X',
  });
  expect([200, 201]).toContain(res.status);
  const device = await models.Device.findOne({ where: { assetId: mac.id } });
  const tf = await applyForm();
  await applyInventory(device, { hostname: 'MAC-1', serialNumber: 'C02X' });
  const { form } = expectOk(await w.admin.agent.get(url(tf)));
  expect(form.answers.agent).toMatchObject({ done: true, byAgent: true });
});

it('a form made after the last inventory is not ticked by it', async () => {
  const tf = await applyForm();
  const { markAgentItems } = require('../../src/services/playbooks/ticketForms'); // eslint-disable-line global-require
  await markAgentItems(mac.id, new Date(Date.now() - 60 * 60 * 1000));
  expect(expectOk(await w.admin.agent.get(url(tf))).form.answers.agent).toBeUndefined();
});
