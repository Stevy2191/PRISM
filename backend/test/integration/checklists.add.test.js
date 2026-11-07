const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('./fixtures');

// PB2 task 2: adding one checklist to a ticket, without a bundle.

let w;
let company;
let jordan;
let ticket;
let mac;
let iphone;
let mdmA;
let checklists;

const checklist = async (name, usage, items) => expectOk(await w.admin.agent.post(`${API}/forms`).send({
  name, usage, definition: { sections: [{ key: 's', title: 'Steps', items }] },
}), 201).form;

beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: ['CK Mac', 'CK iPhone'] } });
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes' });
  ticket = await makeTicket(w.admin.agent, { title: 'Termination: Jordan Reyes', contactId: jordan.id });
  const macs = await models.AssetCategory.create({ name: 'CK Mac' });
  const phones = await models.AssetCategory.create({ name: 'CK iPhone' });
  mdmA = await models.Mdm.create({ name: 'Jamf CK' });
  const asset = (name, category, extra = {}) => models.Asset.create({
    assetTag: `CK-${name}`, name, categoryId: category.id, companyId: company.id, assignedToContactId: jordan.id, ...extra,
  });
  mac = await asset('MacBook', macs, { isManaged: true, mdmId: mdmA.id });
  iphone = await asset('iPhone', phones);
  checklists = {
    printer: await checklist('Printer setup', 'ticket', [{ key: 'driver', kind: 'step', body: 'Install the driver', required: true }]),
    checkIn: await checklist('Device check-in', 'device', [
      { key: 'jamf', kind: 'step', body: 'Remove from Jamf', required: true, showWhen: [{ on: 'device', field: 'mdm', op: 'in', value: [mdmA.id] }] },
      { key: 'wipe', kind: 'step', body: 'Wipe', required: true },
      { key: 'checkin', kind: 'action', action: 'check_in' },
    ]),
    checkOut: await checklist('Device check-out', 'device', [
      { key: 'dept', kind: 'step', body: 'Finance only', showWhen: [{ on: 'person', field: 'companyId', op: 'is', value: company.id }] },
      { key: 'out', kind: 'action', action: 'check_out' },
    ]),
  };
});
afterAll(closeDb);

const add = (body) => w.admin.agent.post(`${API}/tickets/${ticket.id}/checklists`).send(body);

it('lists active checklists with what they are for and do', async () => {
  await models.Form.update({ isActive: false }, { where: { id: checklists.checkOut.id } });
  const opts = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks/options`));
  const byName = Object.fromEntries(opts.checklists.map((c) => [c.name, c]));
  expect(byName['Printer setup']).toMatchObject({ usage: 'ticket', steps: 1, finish: null });
  expect(byName['Device check-in']).toMatchObject({ usage: 'device', steps: 2, finish: 'check_in' });
  expect(byName['Device check-out']).toBeUndefined();
});

it("with a device checklist, lists the person's devices and how many steps show on each", async () => {
  const opts = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks/options?formId=${checklists.checkIn.id}&contactId=${jordan.id}`));
  const byName = Object.fromEntries(opts.personDevices.map((d) => [d.asset.name, d.steps]));
  expect(byName).toEqual({ MacBook: { shown: 2, hidden: 0 }, iPhone: { shown: 1, hidden: 1 } }); // the check-in action isn't a step
});

it('adds a ticket checklist at once', async () => {
  const res = expectOk(await add({ formId: checklists.printer.id }), 201);
  expect(res.added).toHaveLength(1);
  expect(res.added[0]).toMatchObject({ formName: 'Printer setup', ticketPlaybookId: null, asset: null, progress: { required: 1, done: 0 } });
  expect(res.otherForms).toHaveLength(1);
  const task = await models.Task.findByPk(res.added[0].task.id);
  expect(task.title).toBe('Printer setup');
  const activity = await models.TicketActivity.findOne({ where: { ticketId: ticket.id, action: 'checklist_added' } });
  expect(activity.toValue).toBe('Printer setup');
});

it("adds a device checklist for each of the person's ticked devices, and links them", async () => {
  const res = expectOk(await add({ formId: checklists.checkIn.id, contactId: jordan.id, assetIds: [mac.id, iphone.id] }), 201);
  // In asset tag order.
  expect(res.added.map((f) => f.asset.name)).toEqual(['iPhone', 'MacBook']);
  expect(res.added.map((f) => f.progress.required)).toEqual([2, 3]); // the Jamf step shows for the Mac only
  expect(res.added[0].contact).toMatchObject({ id: jordan.id });
  expect(await models.AssetTicket.count({ where: { ticketId: ticket.id } })).toBe(2);
  const activity = await models.TicketActivity.findOne({ where: { ticketId: ticket.id, action: 'checklist_added' } });
  expect(activity.toValue).toBe('Device check-in for iPhone, MacBook (for Jordan Reyes)');
});

it('narrows to the ticked devices, and adds another device of the company', async () => {
  const spare = await models.Asset.create({ assetTag: 'CK-spare', name: 'Spare Mac', categoryId: mac.categoryId, companyId: company.id });
  const res = expectOk(await add({ formId: checklists.checkOut.id, contactId: jordan.id, assetIds: [spare.id] }), 201);
  expect(res.added.map((f) => f.asset.name)).toEqual(['Spare Mac']);
});

it("uses the checklist's person for its person conditions and its check-out", async () => {
  const spare = await models.Asset.create({ assetTag: 'CK-spare', name: 'Spare Mac', categoryId: mac.categoryId, companyId: company.id });
  const { added: [tf] } = expectOk(await add({ formId: checklists.checkOut.id, contactId: jordan.id, assetIds: [spare.id] }), 201);
  const view = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/forms/${tf.id}`)).form;
  expect(view.person).toMatchObject({ id: jordan.id });
  expect(view.evaluation.sections[0].items[0].shown).toBe(true); // the person condition sees Jordan
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}/forms/${tf.id}`).send({ answers: { dept: { done: true } } }));
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/forms/${tf.id}/action`).send({}));
  await spare.reload();
  expect(spare.assignedToContactId).toBe(jordan.id);
});

it('refuses what applying a bundle refuses', async () => {
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  const stranger = await makeContact(w.admin, { companyId: other.id, firstName: 'Sam', lastName: 'Lee' });
  const theirs = await models.Asset.create({ assetTag: 'CK-theirs', name: 'Their Mac', categoryId: mac.categoryId, companyId: other.id });
  expect((await add({ formId: checklists.checkIn.id, contactId: stranger.id })).status).toBe(400);
  expect((await add({ formId: checklists.checkIn.id, contactId: jordan.id, assetIds: [theirs.id] })).status).toBe(400);
  expect((await add({ formId: checklists.checkIn.id, contactId: jordan.id, assetIds: [] })).status).toBe(400);
  expect((await add({ formId: checklists.checkIn.id })).status).toBe(400); // no person, no devices
  await models.Form.update({ isActive: false }, { where: { id: checklists.printer.id } });
  expect((await add({ formId: checklists.printer.id })).status).toBe(404);
  expect(await models.TicketForm.count({ where: { ticketId: ticket.id } })).toBe(0);
});

it('removes a checklist added on its own while nothing on it is started', async () => {
  const { added: [a] } = expectOk(await add({ formId: checklists.printer.id }), 201);
  const { added: [b] } = expectOk(await add({ formId: checklists.printer.id }), 201);
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}/forms/${b.id}`).send({ answers: { driver: { done: true } } }));
  expect((await w.admin.agent.delete(`${API}/tickets/${ticket.id}/checklists/${b.id}`)).status).toBe(409);
  const after = expectOk(await w.admin.agent.delete(`${API}/tickets/${ticket.id}/checklists/${a.id}`));
  expect(after.otherForms.map((f) => f.id)).toEqual([b.id]);
  expect(await models.Task.findByPk(a.task.id)).toBeNull();
});
