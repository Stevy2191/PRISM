const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, makeContact,
} = require('./fixtures');

// Sub-project PB, task 4: forms and playbooks in Settings, and the preview.

let w;
let laptops;
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: ['PB Laptops', 'PB Phones'] } });
  w = await makeWorld();
  laptops = await models.AssetCategory.create({ name: 'PB Laptops' });
});
afterAll(closeDb);

const deviceForm = (extra = []) => ({
  sections: [{
    key: 'start',
    title: 'Before you start',
    items: [
      { key: 'serial', kind: 'field', fieldType: 'text', label: 'Serial number', required: true },
      ...extra,
      { key: 'checkin', kind: 'action', action: 'check_in' },
    ],
  }],
});
const ticketForm = () => ({ sections: [{ key: 'acct', title: 'Account', items: [{ key: 'disable', kind: 'step', body: 'Disable the account', required: true }] }] });

const makeForm = async (body) => expectOk(await w.admin.agent.post(`${API}/forms`).send(body), 201).form;

it('a form is saved as version 1; each save is a new version; a ticket form keeps its own', async () => {
  const form = await makeForm({ name: 'Device check-in', usage: 'device', definition: deviceForm() });
  expect(form).toMatchObject({ version: 1, usage: 'device', isActive: true, inUse: 0 });
  const firstVersionId = form.versionId;

  // A ticket form on version 1.
  const ticket = expectOk(await w.admin.agent.post(`${API}/tickets`).send({ title: 'Check-in', contactId: w.contact.id }), 201).ticket;
  const status = await models.TaskStatus.findOne({ where: { scope: 'ticket' } });
  const task = await models.Task.create({ ticketId: ticket.id, title: 'Device check-in', statusId: status.id });
  const tf = await models.TicketForm.create({ ticketId: ticket.id, formVersionId: firstVersionId, taskId: task.id });

  const extra = [{ key: 'wipe', kind: 'step', body: 'Wipe it', required: true }];
  const saved = expectOk(await w.admin.agent.put(`${API}/forms/${form.id}`).send({ name: 'Device check-in v2', definition: deviceForm(extra) })).form;
  expect(saved).toMatchObject({ version: 2, name: 'Device check-in v2', inUse: 1 });
  expect(saved.definition.sections[0].items.map((i) => i.key)).toEqual(['serial', 'wipe', 'checkin']);
  expect((await models.TicketForm.findByPk(tf.id)).formVersionId).toBe(firstVersionId);
  const v1 = await models.FormVersion.findByPk(firstVersionId);
  expect(v1.definition.sections[0].items.map((i) => i.key)).toEqual(['serial', 'checkin']);
});

it('refuses a bad definition, and a device item on a once-per-ticket form', async () => {
  const res = await w.admin.agent.post(`${API}/forms`).send({ name: 'Bad', usage: 'ticket', definition: deviceForm() });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('FORM_INVALID');
  expect((await w.admin.agent.post(`${API}/forms`).send({ name: 'Bad', usage: 'sometimes', definition: ticketForm() })).status).toBe(400);
  expect((await w.admin.agent.post(`${API}/forms`).send({ name: ' ', usage: 'ticket', definition: ticketForm() })).status).toBe(400);
});

it('only playbook managers change forms and playbooks; ticket editors may read them', async () => {
  const form = await makeForm({ name: 'Account', usage: 'ticket', definition: ticketForm() });
  const tech = await makeTech('tech1', w.deptA.id);
  expectOk(await tech.agent.get(`${API}/forms`));
  expectOk(await tech.agent.get(`${API}/forms/${form.id}`));
  expectOk(await tech.agent.get(`${API}/playbooks`));
  expect((await tech.agent.post(`${API}/forms`).send({ name: 'x', usage: 'ticket', definition: ticketForm() })).status).toBe(403);
  expect((await tech.agent.put(`${API}/forms/${form.id}`).send({ definition: ticketForm() })).status).toBe(403);
  expect((await tech.agent.post(`${API}/playbooks`).send({ name: 'x', blocks: [] })).status).toBe(403);
});

it('a form can be switched off and back on', async () => {
  const form = await makeForm({ name: 'Account', usage: 'ticket', definition: ticketForm() });
  expectOk(await w.admin.agent.patch(`${API}/forms/${form.id}`).send({ isActive: false }));
  expect(expectOk(await w.admin.agent.get(`${API}/forms?active=true`)).forms).toHaveLength(0);
  expect(expectOk(await w.admin.agent.get(`${API}/forms`)).forms).toHaveLength(1);
});

it('checks a playbook\'s forms: right usage for how they apply, and a person for the person\'s devices', async () => {
  const acct = await makeForm({ name: 'Account', usage: 'ticket', definition: ticketForm() });
  const dev = await makeForm({ name: 'Device check-in', usage: 'device', definition: deviceForm() });
  const post = (body) => w.admin.agent.post(`${API}/playbooks`).send({ name: 'Termination', ...body });
  expect((await post({ blocks: [{ formId: dev.id, applies: 'once' }] })).status).toBe(400);
  expect((await post({ blocks: [{ formId: acct.id, applies: 'person_devices' }], needsPerson: true })).status).toBe(400);
  expect((await post({ blocks: [{ formId: dev.id, applies: 'person_devices' }] })).status).toBe(400); // no person
  expect((await post({ blocks: [{ formId: 999999, applies: 'once' }] })).status).toBe(400);
  expect((await post({ blocks: [{ formId: dev.id, applies: 'ticket_devices', limits: { mdmIds: [999999] } }] })).status).toBe(400);
  const { playbook } = expectOk(await post({
    needsPerson: true,
    blocks: [
      { formId: acct.id, applies: 'once', limits: { managed: true } },
      { formId: dev.id, applies: 'person_devices', limits: { categoryIds: [laptops.id], managed: false, junk: 1 } },
    ],
  }), 201);
  expect(playbook.blocks).toEqual([
    expect.objectContaining({ formId: acct.id, applies: 'once', limits: {} }),
    expect.objectContaining({ formId: dev.id, applies: 'person_devices', limits: { categoryIds: [laptops.id], managed: false } }),
  ]);
  expect(playbook.blocks[1].form.name).toBe('Device check-in');

  // PUT keeps what isn't sent.
  const { playbook: renamed } = expectOk(await w.admin.agent.put(`${API}/playbooks/${playbook.id}`).send({ name: 'Leaving' }));
  expect(renamed).toMatchObject({ name: 'Leaving', needsPerson: true });
  expect(renamed.blocks).toHaveLength(2);
});

it('preview: which form each of a person\'s devices gets, and what is not covered', async () => {
  const dev = await makeForm({ name: 'Device check-in', usage: 'device', definition: deviceForm() });
  const { playbook } = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Termination', needsPerson: true, blocks: [{ formId: dev.id, applies: 'person_devices', limits: { categoryIds: [laptops.id] } }],
  }), 201);
  const phones = await models.AssetCategory.create({ name: 'PB Phones' });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const make = (name, categoryId, extra = {}) => models.Asset.create({
    assetTag: `PV-${name}`, name, categoryId, companyId: internal.id, assignedToContactId: w.contact.id, ...extra,
  });
  await make('Laptop', laptops.id);
  await make('Phone', phones.id);
  await make('Old laptop', laptops.id, { status: 'retired' });

  const out = expectOk(await w.admin.agent.post(`${API}/playbooks/${playbook.id}/preview`).send({ contactId: w.contact.id }));
  expect(out.forms.map((f) => [f.formName, f.asset.name])).toEqual([['Device check-in', 'Laptop']]);
  expect(out.uncovered.map((a) => a.name)).toEqual(['Phone']);

  // Offered for other companies only: refused for this person.
  const other = await makeCompany(w.admin, { name: 'Other Co' });
  expectOk(await w.admin.agent.put(`${API}/playbooks/${playbook.id}`).send({ companyIds: [other.id] }));
  expect((await w.admin.agent.post(`${API}/playbooks/${playbook.id}/preview`).send({ contactId: w.contact.id })).status).toBe(400);
  const outsider = await makeContact(w.admin, { companyId: other.id });
  expectOk(await w.admin.agent.post(`${API}/playbooks/${playbook.id}/preview`).send({ contactId: outsider.id }));
});
