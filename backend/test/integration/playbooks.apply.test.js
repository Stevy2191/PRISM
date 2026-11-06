const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, makeContact, makeTicket,
} = require('./fixtures');

// Sub-project PB, task 6: applying a playbook to a ticket, and devices on the
// ticket. Shaped like the ApplyPlaybook mockup: a Mac on MDM A, an iPhone on
// MDM B, an unmanaged laptop, and a tablet with no MDM set.

let w;
let company;
let jordan;
let ticket;
let cats;
let mdmA;
let mdmB;
let forms;
let devs;

const form = async (name, usage, items) => expectOk(await w.admin.agent.post(`${API}/forms`).send({
  name, usage, definition: { sections: [{ key: 's', title: 'Steps', items }] },
}), 201).form;

beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: ['PB Mac', 'PB iPhone', 'PB Laptop', 'PB Tablet'] } });
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes', email: 'jreyes@county.example' });
  ticket = await makeTicket(w.admin.agent, { title: 'Termination: Jordan Reyes, last day Nov 14', contactId: (await makeContact(w.admin, { companyId: company.id, firstName: 'Pat', lastName: 'Morgan' })).id });
  cats = {};
  for (const n of ['Mac', 'iPhone', 'Laptop', 'Tablet']) cats[n] = await models.AssetCategory.create({ name: `PB ${n}` }); // eslint-disable-line no-await-in-loop
  mdmA = await models.Mdm.create({ name: 'MDM A' });
  mdmB = await models.Mdm.create({ name: 'MDM B' });
  const asset = (name, category, extra = {}) => models.Asset.create({
    assetTag: `T-${name}`, name, categoryId: category.id, companyId: company.id, assignedToContactId: jordan.id, ...extra,
  });
  devs = {
    mac: await asset('MacBook', cats.Mac, { isManaged: true, mdmId: mdmA.id }),
    iphone: await asset('iPhone', cats.iPhone, { isManaged: true, mdmId: mdmB.id }),
    laptop: await asset('Dell', cats.Laptop),
    tablet: await asset('iPad', cats.Tablet),
  };
  forms = {
    account: await form('Account termination', 'ticket', [{ key: 'disable', kind: 'step', body: 'Disable the account', required: true }]),
    apple: await form('Apple check-in', 'device', [{ key: 'wipe', kind: 'step', body: 'Wipe', required: true }, { key: 'checkin', kind: 'action', action: 'check_in' }]),
    device: await form('Device check-in', 'device', [{ key: 'wipe', kind: 'step', body: 'Wipe', required: true }, { key: 'checkin', kind: 'action', action: 'check_in' }]),
    checkout: await form('Device check-out', 'device', [{ key: 'serial', kind: 'field', fieldType: 'text', label: 'Serial', required: true }, { key: 'out', kind: 'action', action: 'check_out' }]),
  };
});
afterAll(closeDb);

async function termination(extra = {}) {
  return expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Account termination',
    needsPerson: true,
    blocks: [
      { formId: forms.account.id, applies: 'once' },
      { formId: forms.apple.id, applies: 'person_devices', limits: { categoryIds: [cats.Mac.id, cats.iPhone.id, cats.Tablet.id], managed: true } },
      { formId: forms.device.id, applies: 'person_devices', limits: { managed: false, categoryIds: [cats.Laptop.id] } },
    ],
    ...extra,
  }), 201).playbook;
}

it('offers the playbooks for the company, guesses the person, and previews their devices', async () => {
  const playbook = await termination();
  const opts = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks/options`));
  expect(opts.playbooks.map((p) => p.name)).toEqual(['Account termination']);
  expect(opts.guesses.map((g) => g.id)).toEqual([jordan.id]);

  const preview = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks/options?playbookId=${playbook.id}&contactId=${jordan.id}`));
  const byName = Object.fromEntries(preview.personDevices.map((d) => [d.asset.name, d.form && d.form.name]));
  expect(byName).toEqual({
    MacBook: 'Apple check-in', iPhone: 'Apple check-in', Dell: 'Device check-in', iPad: null,
  });
  expect(preview.uncovered.map((d) => d.name)).toEqual(['iPad']);
  expect(preview.onceForms.map((f) => f.name)).toEqual(['Account termination']);
});

it('applying adds the forms as tasks, links the devices, and lists the one not covered', async () => {
  const playbook = await termination();
  const out = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id }), 201);
  expect(out.added).toMatchObject({ name: 'Account termination', contact: { id: jordan.id } });
  const forms4 = out.added.forms.map((f) => [f.formName, f.asset && f.asset.name]);
  expect(forms4).toEqual([
    ['Account termination', null], ['Apple check-in', 'iPhone'], ['Apple check-in', 'MacBook'], ['Device check-in', 'Dell'],
  ]);
  expect(out.added.forms[1].progress).toEqual({ required: 2, done: 0 });
  expect(out.devices.map((d) => d.name).sort()).toEqual(['Dell', 'MacBook', 'iPad', 'iPhone']);
  expect(out.uncovered.map((d) => d.name)).toEqual(['iPad']);

  const { tasks } = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`));
  expect(tasks.map((t) => t.title)).toEqual([
    'Account termination', 'Apple check-in: iPhone, T-iPhone', 'Apple check-in: MacBook, T-MacBook', 'Device check-in: Dell, T-Dell',
  ]);
  const activity = await models.TicketActivity.findOne({ where: { ticketId: ticket.id, action: 'playbook_applied' } });
  expect(activity.toValue).toBe('Account termination for Jordan Reyes');
});

it('only the ticked devices are added', async () => {
  const playbook = await termination();
  const out = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({
    playbookId: playbook.id, contactId: jordan.id, assetIds: [devs.mac.id],
  }), 201);
  expect(out.added.forms.map((f) => f.asset && f.asset.name)).toEqual([null, 'MacBook']);
  expect(out.devices.map((d) => d.name)).toEqual(['MacBook']);
});

it('refuses a person of another company, no person when one is needed, and a playbook not offered here', async () => {
  const playbook = await termination();
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  const outsider = await makeContact(w.admin, { companyId: other.id });
  const post = (body) => w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, ...body });
  expect((await post({ contactId: outsider.id })).status).toBe(400);
  expect((await post({})).status).toBe(400);
  expectOk(await w.admin.agent.put(`${API}/playbooks/${playbook.id}`).send({ companyIds: [other.id] }));
  expect((await post({ contactId: jordan.id })).status).toBe(400);
  expect(await models.TicketPlaybook.count()).toBe(0);
});

it('may be applied twice, for two people; and removed only while untouched', async () => {
  const playbook = await termination();
  const pat = await makeContact(w.admin, { companyId: company.id, firstName: 'Sam', lastName: 'Lee' });
  const first = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id }), 201).added;
  const second = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: pat.id }), 201).added;
  expect(second.forms).toHaveLength(1); // Sam has no devices

  await models.TicketForm.update({ answers: { disable: { done: true } } }, { where: { id: first.forms[0].id } });
  expect((await w.admin.agent.delete(`${API}/tickets/${ticket.id}/playbooks/${first.id}`)).status).toBe(409);
  const left = expectOk(await w.admin.agent.delete(`${API}/tickets/${ticket.id}/playbooks/${second.id}`));
  expect(left.applied.map((a) => a.id)).toEqual([first.id]);
  expect(await models.Task.count({ where: { ticketId: ticket.id } })).toBe(4);
});

it('editing the playbook later does not change a ticket it was applied to', async () => {
  const playbook = await termination();
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id }), 201);
  expectOk(await w.admin.agent.put(`${API}/playbooks/${playbook.id}`).send({ name: 'Leaving', blocks: [{ formId: forms.account.id, applies: 'once' }] }));
  const view = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks`));
  expect(view.applied[0].name).toBe('Account termination');
  expect(view.applied[0].forms).toHaveLength(4);
});

it('needs edit rights on the ticket to apply; viewing is enough to see the forms', async () => {
  const playbook = await termination();
  const staff = await makeTech('viewer', w.deptB.id);
  await models.UserPermissionOverride.bulkCreate(['tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all'].map((permissionKey) => ({ userId: staff.user.id, permissionKey, granted: false })));
  require('../../src/services/permissionService').invalidateAllPermissions(); // eslint-disable-line global-require
  expect((await staff.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id })).status).toBe(403);
});

describe('devices on the ticket', () => {
  async function newAccount() {
    const playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
      name: 'New account', blocks: [{ formId: forms.account.id, applies: 'once' }, { formId: forms.checkout.id, applies: 'ticket_devices' }],
    }), 201).playbook;
    const t = await makeTicket(w.admin.agent, { title: 'New account: Taylor Brooks', contactId: jordan.id });
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/playbooks`).send({ playbookId: playbook.id }), 201);
    return t;
  }

  it('linking a device adds its form; unlinking removes it while untouched', async () => {
    const t = await newAccount();
    const out = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/devices`).send({ assetId: devs.laptop.id }), 201);
    expect(out.applied[0].forms.map((f) => [f.formName, f.asset && f.asset.name])).toEqual([['Account termination', null], ['Device check-out', 'Dell']]);
    // Linking again adds nothing.
    expect(expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/devices`).send({ assetId: devs.laptop.id }), 201).applied[0].forms).toHaveLength(2);
    const after = expectOk(await w.admin.agent.delete(`${API}/tickets/${t.id}/devices/${devs.laptop.id}`));
    expect(after.applied[0].forms).toHaveLength(1);
    expect(after.devices).toEqual([]);
  });

  it('a started form stays when its device is unlinked', async () => {
    const t = await newAccount();
    const out = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/devices`).send({ assetId: devs.laptop.id }), 201);
    await models.TicketForm.update({ answers: { serial: 'ABC' } }, { where: { id: out.applied[0].forms[1].id } });
    const after = expectOk(await w.admin.agent.delete(`${API}/tickets/${t.id}/devices/${devs.laptop.id}`));
    expect(after.keptForms).toBe(1);
    expect(after.applied[0].forms).toHaveLength(2);
  });

  it('creates a device in the ticket\'s company, warns without a serial, and adds its form', async () => {
    const t = await newAccount();
    const out = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/devices/new`).send({
      name: 'MacBook Air', categoryId: cats.Mac.id, isManaged: true, mdmId: mdmA.id, companyId: 999999,
    }), 201);
    expect(out.asset.companyId).toBe(company.id);
    expect(out.warnings).toContain('SERIAL_EMPTY');
    expect(out.applied[0].forms.map((f) => f.asset && f.asset.name)).toEqual([null, 'MacBook Air']);
    const withSerial = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/devices/new`).send({ name: 'Second', categoryId: cats.Mac.id, serialNumber: 'C02X' }), 201);
    expect(withSerial.warnings).not.toContain('SERIAL_EMPTY');
  });

  it('refuses a device of another company, and creating without Create assets', async () => {
    const t = await newAccount();
    const other = await makeCompany(w.admin, { name: 'Elsewhere' });
    const foreign = await models.Asset.create({ assetTag: 'X-1', name: 'Foreign', categoryId: cats.Laptop.id, companyId: other.id });
    expect((await w.admin.agent.post(`${API}/tickets/${t.id}/devices`).send({ assetId: foreign.id })).status).toBe(400);
    const tech = await makeTech('nocreate', w.deptA.id);
    await models.UserPermissionOverride.create({ userId: tech.user.id, permissionKey: 'assets.create', granted: false });
    require('../../src/services/permissionService').invalidateAllPermissions(); // eslint-disable-line global-require
    await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ assigneeId: tech.user.id });
    const res = await tech.agent.post(`${API}/tickets/${t.id}/devices/new`).send({ name: 'Nope', categoryId: cats.Laptop.id });
    expect([403]).toContain(res.status);
  });
});
