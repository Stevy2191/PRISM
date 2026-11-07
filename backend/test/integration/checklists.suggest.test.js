const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, makeContact, makeTicket,
} = require('./fixtures');

// PB2 task 3: bundles that suggest themselves by ticket category, and the
// checklist editor's Try it.

let w;
let company;
let accounts;
let termination;
let other;
let bundle;

const checklist = async () => expectOk(await w.admin.agent.post(`${API}/forms`).send({
  name: 'Account termination', usage: 'ticket', definition: { sections: [{ key: 's', title: 'Steps', items: [{ key: 'a', kind: 'step', body: 'Disable' }] }] },
}), 201).form;

beforeEach(async () => {
  await resetData();
  await models.TicketCategory.destroy({ where: { name: ['CK Accounts', 'CK Termination', 'CK Printers'] } });
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  accounts = await models.TicketCategory.create({ name: 'CK Accounts' });
  termination = await models.TicketCategory.create({ name: 'CK Termination', parentId: accounts.id });
  other = await models.TicketCategory.create({ name: 'CK Printers' });
  const form = await checklist();
  bundle = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Termination', blocks: [{ formId: form.id, applies: 'once' }], suggestCategoryIds: [termination.id],
  }), 201).playbook;
});
afterAll(closeDb);

const suggested = async (ticketId) => (await models.TicketPlaybookSuggestion.findAll({ where: { ticketId } })).map((s) => s.playbookId);
const newTicket = async (categoryId) => makeTicket(w.admin.agent, {
  title: 'Termination: Jordan Reyes',
  contactId: (await makeContact(w.admin, { companyId: company.id, firstName: 'Jo', lastName: `R${Math.random()}` })).id,
  categoryId,
});

describe('category suggestions', () => {
  it('stores the categories on the bundle, and refuses an unknown one', async () => {
    expect(bundle.suggestCategoryIds).toEqual([termination.id]);
    const res = await w.admin.agent.put(`${API}/playbooks/${bundle.id}`).send({ suggestCategoryIds: [999999] });
    expect(res.status).toBe(400);
  });

  it('suggests the bundle on a new ticket in its category, once', async () => {
    const ticket = await newTicket(termination.id);
    expect(await suggested(ticket.id)).toEqual([bundle.id]);
    const view = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks`));
    expect(view.suggestions.map((s) => s.playbook.name)).toEqual(['Termination']);
    await models.Ticket.update({ title: 'Renamed' }, { where: { id: ticket.id }, individualHooks: true });
    expect(await suggested(ticket.id)).toEqual([bundle.id]);
  });

  it('covers the categories under the one it lists', async () => {
    expectOk(await w.admin.agent.put(`${API}/playbooks/${bundle.id}`).send({ suggestCategoryIds: [accounts.id] }));
    const ticket = await newTicket(termination.id);
    expect(await suggested(ticket.id)).toEqual([bundle.id]);
  });

  it('suggests it when a ticket moves into the category, and a dismissal sticks', async () => {
    const ticket = await newTicket(other.id);
    expect(await suggested(ticket.id)).toEqual([]);
    expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ categoryId: termination.id }));
    expect(await suggested(ticket.id)).toEqual([bundle.id]);
    const [s] = await models.TicketPlaybookSuggestion.findAll({ where: { ticketId: ticket.id } });
    expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbook-suggestions/${s.id}/dismiss`));
    expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ categoryId: other.id }));
    expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ categoryId: termination.id }));
    const rows = await models.TicketPlaybookSuggestion.findAll({ where: { ticketId: ticket.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].dismissedAt).not.toBeNull();
  });

  it("leaves out bundles that are off, or not offered for the ticket's company", async () => {
    const elsewhere = await makeCompany(w.admin, { name: 'Elsewhere' });
    expectOk(await w.admin.agent.put(`${API}/playbooks/${bundle.id}`).send({ companyIds: [elsewhere.id] }));
    expect(await suggested((await newTicket(termination.id)).id)).toEqual([]);
    expectOk(await w.admin.agent.put(`${API}/playbooks/${bundle.id}`).send({ companyIds: null }));
    await models.Playbook.update({ isActive: false }, { where: { id: bundle.id } });
    expect(await suggested((await newTicket(termination.id)).id)).toEqual([]);
  });
});

describe('Try it', () => {
  let jamf;
  let mac;
  let phone;
  beforeEach(async () => {
    await models.AssetCategory.destroy({ where: { name: ['CK Try Mac', 'CK Try iPhone'] } });
    jamf = await models.Mdm.create({ name: 'Jamf Try' });
    mac = await models.AssetCategory.create({ name: 'CK Try Mac' });
    phone = await models.AssetCategory.create({ name: 'CK Try iPhone' });
  });

  const definition = () => ({
    sections: [{
      key: 's',
      title: 'Wipe',
      items: [
        { key: 'jamf', kind: 'step', body: 'Remove from Jamf', showWhen: [{ on: 'device', field: 'mdm', op: 'in', value: [jamf.id] }] },
        { key: 'mac', kind: 'step', body: 'Mac only', showWhen: [{ on: 'device', field: 'categoryId', op: 'in', value: [mac.id] }] },
        { key: 'always', kind: 'step', body: 'Always' },
        { key: 'in', kind: 'action', action: 'check_in' },
      ],
    }],
  });
  const tryIt = (agent, device) => agent.post(`${API}/forms/try`).send({ usage: 'device', definition: definition(), device });

  it('shows which lines show for a device, saving nothing', async () => {
    const before = await models.Form.count();
    const macOnJamf = expectOk(await tryIt(w.admin.agent, { categoryId: mac.id, mdm: jamf.id }));
    expect(macOnJamf).toMatchObject({ shown: 3, hidden: 0 });
    const unmanagedPhone = expectOk(await tryIt(w.admin.agent, { categoryId: phone.id, mdm: 'none' }));
    expect(unmanagedPhone).toMatchObject({ shown: 1, hidden: 2 });
    expect(unmanagedPhone.evaluation.sections[0].items.map((i) => i.shown)).toEqual([false, false, true, true]);
    expect(await models.Form.count()).toBe(before);
  });

  it('checks the definition, and needs the checklists permission', async () => {
    const bad = await w.admin.agent.post(`${API}/forms/try`).send({ usage: 'device', definition: { sections: 'nope' }, device: {} });
    expect(bad.status).toBe(400);
    const tech = await makeTech('ck_tech', w.deptA.id);
    expect((await tryIt(tech.agent, { categoryId: mac.id, mdm: 'none' })).status).toBe(403);
  });
});
