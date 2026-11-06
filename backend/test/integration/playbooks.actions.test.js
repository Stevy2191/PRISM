const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { invalidateAllPermissions } = require('../../src/services/permissionService');

// Sub-project PB, task 7: secure values and the device actions.

const SECRET = 'BYPASS-7731-XQ';

let w;
let company;
let jordan;
let ticket;
let laptop;
let category;

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes' });
  ticket = await makeTicket(w.admin.agent, { title: 'Device for Jordan Reyes', contactId: jordan.id });
  category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  laptop = await models.Asset.create({ assetTag: 'T-LT', name: 'Laptop', categoryId: category.id, companyId: company.id, serialNumber: 'S1' });
});
afterAll(closeDb);

async function formOn(action, extraItems = [], { applies = 'ticket_devices', assigned = false } = {}) {
  const def = {
    sections: [{
      key: 's',
      title: 'Steps',
      items: [
        { key: 'ready', kind: 'step', body: 'Ready', required: true },
        { key: 'code', kind: 'secure', label: 'Bypass code' },
        ...extraItems,
        { key: 'act', kind: 'action', action },
      ],
    }],
  };
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({ name: action === 'check_out' ? 'Check-out' : 'Check-in', usage: 'device', definition: def }), 201).form;
  const playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({ name: 'P', needsPerson: true, blocks: [{ formId: form.id, applies }] }), 201).playbook;
  if (assigned) await laptop.update({ assignedToContactId: jordan.id });
  if (applies === 'ticket_devices') expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/devices`).send({ assetId: laptop.id }), 201);
  const out = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id }), 201);
  return out.added.forms.find((f) => f.asset);
}
const url = (tf, rest = '') => `${API}/tickets/${ticket.id}/forms/${tf.id}${rest}`;

describe('secure values', () => {
  it('are kept encrypted and returned only by reveal, which is logged', async () => {
    const tf = await formOn('check_in', [], { applies: 'person_devices', assigned: true });
    const { form } = expectOk(await w.admin.agent.put(url(tf, '/secrets/code')).send({ value: SECRET }));
    expect(form.secrets.code).toMatchObject({ set: true, setBy: 'Test admin' });
    const stored = await models.TicketFormSecret.unscoped().findOne({ where: { ticketFormId: tf.id } });
    expect(stored.ciphertext).not.toContain(SECRET);

    // Nowhere else.
    const everywhere = JSON.stringify([
      expectOk(await w.admin.agent.get(url(tf))),
      expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}`)),
      expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks`)),
      expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/activity`)),
      expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)),
      expectOk(await w.admin.agent.get(`${API}/search?q=${SECRET}`)),
      await models.AuditLog.findAll(),
    ]);
    expect(everywhere).not.toContain(SECRET);

    expect(expectOk(await w.admin.agent.post(url(tf, '/secrets/code/reveal'))).value).toBe(SECRET);
    expect(await models.TicketActivity.count({ where: { ticketId: ticket.id, action: 'form_secret_revealed' } })).toBe(1);
    expect(await models.AuditLog.count({ where: { action: 'ticketForm.secret_revealed' } })).toBe(1);
  });

  it('reveal needs the permission and is rate limited', async () => {
    const tf = await formOn('check_in', [], { applies: 'person_devices', assigned: true });
    expectOk(await w.admin.agent.put(url(tf, '/secrets/code')).send({ value: SECRET }));
    const staff = await makeTech('nosecrets', w.deptA.id);
    await models.UserPermissionOverride.create({ userId: staff.user.id, permissionKey: 'tickets.view_secure_fields', granted: false });
    invalidateAllPermissions();
    expect((await staff.agent.post(url(tf, '/secrets/code/reveal'))).status).toBe(403);
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expectOk(await w.admin.agent.post(url(tf, '/secrets/code/reveal')));
    }
    expect((await w.admin.agent.post(url(tf, '/secrets/code/reveal'))).status).toBe(429);
  });

  it("can't be sent as an ordinary answer, and only for a secure item", async () => {
    const tf = await formOn('check_in', [], { applies: 'person_devices', assigned: true });
    expect((await w.admin.agent.patch(url(tf)).send({ answers: { code: SECRET } })).status).toBe(400);
    expect((await w.admin.agent.put(url(tf, '/secrets/ready')).send({ value: SECRET })).status).toBe(400);
  });
});

describe('device actions', () => {
  it('check-out waits for the other steps, checks the device out to the person, and runs once', async () => {
    const tf = await formOn('check_out');
    const early = await w.admin.agent.post(url(tf, '/action')).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ACTION_NOT_READY');
    expectOk(await w.admin.agent.patch(url(tf)).send({ answers: { ready: true } }));
    const { form } = expectOk(await w.admin.agent.post(url(tf, '/action')).send({}));
    expect(form.state).toBe('finished');
    expect(form.actionDoneAt).toBeTruthy();
    const fresh = await models.Asset.findByPk(laptop.id);
    expect(fresh.assignedToContactId).toBe(jordan.id);
    expect(await models.AssetCheckout.count({ where: { assetId: laptop.id, contactId: jordan.id, checkedInAt: null } })).toBe(1);
    const again = await w.admin.agent.post(url(tf, '/action')).send({});
    expect(again.status).toBe(409);
    expect(await models.AssetCheckout.count({ where: { assetId: laptop.id } })).toBe(1);
  });

  it('check-out refuses a device out to someone else', async () => {
    const tf = await formOn('check_out');
    const other = await makeContact(w.admin, { companyId: company.id, firstName: 'Sam' });
    expectOk(await w.admin.agent.post(`${API}/assets/${laptop.id}/checkouts`).send({ contactId: other.id }), 201);
    expectOk(await w.admin.agent.patch(url(tf)).send({ answers: { ready: true } }));
    const res = await w.admin.agent.post(url(tf, '/action')).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CHECKED_OUT');
    expect(expectOk(await w.admin.agent.get(url(tf))).form.actionDoneAt).toBeNull();
  });

  it('check-in sets the status the form allows and can revoke the agent', async () => {
    const tf = await formOn('check_in', [], { applies: 'person_devices', assigned: true });
    expectOk(await w.admin.agent.post(`${API}/assets/${laptop.id}/checkouts`).send({ contactId: jordan.id }), 201);
    const device = await models.Device.create({
      assetId: laptop.id, companyId: company.id, publicKey: `${'A'.repeat(43)}=`, platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'LT', lastInventoryAt: new Date(),
    });
    expectOk(await w.admin.agent.patch(url(tf)).send({ answers: { ready: true } }));
    expect((await w.admin.agent.post(url(tf, '/action')).send({ status: 'lost' })).status).toBe(400);
    expect((await w.admin.agent.post(url(tf, '/action')).send({ status: 'on_hold' })).status).toBe(400);
    const { form } = expectOk(await w.admin.agent.post(url(tf, '/action')).send({ status: 'on_hold', holdReason: 'Activation Locked', revokeAgent: true }));
    expect(form.state).toBe('finished');
    expect(await models.Asset.findByPk(laptop.id)).toMatchObject({ status: 'on_hold', holdReason: 'Activation Locked', assignedToContactId: null });
    expect((await models.Device.findByPk(device.id)).revokedAt).toBeTruthy();
  });
});
