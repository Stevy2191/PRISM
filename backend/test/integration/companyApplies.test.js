const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const migration = require('../../migrations/20260101000093-bundle-except-companies');

// What applies to a company (CS part 4): its checklist bundles, on or off
// for it here; and the workflow rules, recurring tickets and custom fields
// that reach it, built in Settings.

let w; let acme; let globex; let accounts; let termination; let plant; let form;

const applies = async (id = acme.id) => expectOk(await w.admin.agent.get(`${API}/companies/${id}/applies`));
const bundle = async (body) => expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
  blocks: [{ formId: form.id, applies: 'once' }], ...body,
}), 201).playbook;
const setOffered = (id, offered, companyId = acme.id) => w.admin.agent.put(`${API}/companies/${companyId}/bundles/${id}`).send({ offered });

beforeEach(async () => {
  await resetData();
  await models.Playbook.destroy({ where: {} });
  await models.TicketCategory.destroy({ where: { name: ['CS Accounts', 'CS Termination'] } });
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex' });
  accounts = await models.TicketCategory.create({ name: 'CS Accounts', companyId: acme.id });
  termination = await models.TicketCategory.create({ name: 'CS Termination', parentId: accounts.id, companyId: acme.id });
  plant = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'Plant floor', companyId: acme.id }), 201).department;
  form = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Steps', usage: 'ticket', definition: { sections: [{ key: 's', title: 'Steps', items: [{ key: 'a', kind: 'step', body: 'Do it' }] }] },
  }), 201).form;
});
afterAll(async () => {
  await models.Playbook.destroy({ where: {} });
  await closeDb();
});

describe('bundles', () => {
  it('lists every bundle: offered or not, where it is suggested for this company, and one built for others', async () => {
    const term = await bundle({ name: 'Termination', suggestCategoryIds: [termination.id] });
    const theirs = await bundle({ name: 'County laptop', companyIds: [globex.id] });
    const { bundles } = await applies();
    expect(bundles).toEqual([
      expect.objectContaining({ id: term.id, offered: true, forOthers: false, suggestedOn: ['CS Accounts › CS Termination'] }),
      expect.objectContaining({ id: theirs.id, offered: false, forOthers: true, suggestedOn: [] }),
    ]);
  });

  it('turning an every-company bundle off here leaves it on for everyone else, and for companies made later', async () => {
    const pb = await bundle({ name: 'New account' });
    const res = expectOk(await setOffered(pb.id, false));
    expect(res.bundles[0].offered).toBe(false);
    expect((await applies(globex.id)).bundles[0].offered).toBe(true);
    const later = await makeCompany(w.admin, { name: 'Later Co' });
    expect((await applies(later.id)).bundles[0].offered).toBe(true);
    // Saving the bundle in Settings keeps it off here.
    expectOk(await w.admin.agent.put(`${API}/playbooks/${pb.id}`).send({ name: 'New account (v2)' }));
    expect((await applies()).bundles[0].offered).toBe(false);
    // A ticket of Acme's can't have it.
    const contact = await makeContact(w.admin, { companyId: acme.id });
    const ticket = await makeTicket(w.admin.agent, { title: 'New hire', contactId: contact.id });
    const applied = await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: pb.id });
    expect(applied.status).toBe(400);
    // Back on.
    expectOk(await setOffered(pb.id, true));
    expect((await models.Playbook.findByPk(pb.id)).exceptCompanyIds).toBeNull();
    expect(await models.AuditLog.count({ where: { action: 'company.bundle', entityId: acme.id } })).toBe(2);
  });

  it("turning on one built for another customer adds this company to its list", async () => {
    const pb = await bundle({ name: 'County laptop', companyIds: [globex.id] });
    expectOk(await setOffered(pb.id, true));
    expect((await models.Playbook.findByPk(pb.id)).companyIds).toEqual([globex.id, acme.id]);
    expect((await applies()).bundles[0]).toMatchObject({ offered: true, forOthers: false });
  });

  it('needs the Checklists permission to change, and a real bundle', async () => {
    const pb = await bundle({ name: 'Termination' });
    const tech = await makeTech('tia', w.deptA.id);
    expectOk(await tech.agent.get(`${API}/companies/${acme.id}/applies`));
    expect((await tech.agent.put(`${API}/companies/${acme.id}/bundles/${pb.id}`).send({ offered: false })).status).toBe(403);
    expect((await setOffered(999999, false)).status).toBe(404);
    expect((await w.admin.agent.put(`${API}/companies/${acme.id}/bundles/${pb.id}`).send({ offered: 'no' })).status).toBe(400);
  });
});

describe('rules, recurring tickets and custom fields', () => {
  it("lists the rules naming this company's departments; the rest are counted as for everyone", async () => {
    const mk = (name, conditions) => models.WorkflowRule.create({ name, triggerEvent: 'ticket_created', isActive: true })
      .then(async (r) => { await models.WorkflowCondition.bulkCreate(conditions.map((c, i) => ({ ruleId: r.id, position: i, operator: 'equals', ...c }))); return r; });
    const globexDept = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'Front desk', companyId: globex.id }), 201).department;
    const ours = await mk('Plant floor outages go to On-call', [{ field: 'department', value: String(plant.id) }]);
    await mk('Globex front desk', [{ field: 'department', value: String(globexDept.id) }]);
    await mk('Critical to the top', [{ field: 'priority', value: 'critical' }]);
    await mk('Anything', []);
    const res = await applies();
    expect(res.rules).toEqual([{ id: ours.id, name: ours.name, isActive: true, departments: ['Plant floor'] }]);
    expect(res.rulesForAll).toBeGreaterThanOrEqual(2);
  });

  it("lists recurring tickets for this company's contacts and departments, with their schedule", async () => {
    const amy = await makeContact(w.admin, { firstName: 'Amy', companyId: acme.id });
    const gus = await makeContact(w.admin, { firstName: 'Gus', companyId: globex.id });
    const base = {
      priority: 'low', type: 'task', frequency: 'weekly', interval: 1, weekdays: [1], timeOfDay: '09:00', timezone: 'America/Chicago', startDate: '2026-01-05',
    };
    const ours = expectOk(await w.admin.agent.post(`${API}/recurring-tickets`).send({ ...base, title: 'Backup check', contactId: amy.id }), 201).recurringTicket
      || (await models.RecurringTicket.findOne({ where: { title: 'Backup check' } }));
    await w.admin.agent.post(`${API}/recurring-tickets`).send({ ...base, title: 'Globex patching', contactId: gus.id });
    const { recurring } = await applies();
    expect(recurring).toEqual([{ id: ours.id, title: 'Backup check', schedule: 'Every week on Mon at 09:00', active: true }]);
  });

  it("lists custom fields on this company's categories; fields on every category are counted", async () => {
    const field = expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Machine number', fieldType: 'text', categoryIds: [accounts.id] }), 201).customField;
    expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Asset tag', fieldType: 'text' }), 201);
    const res = await applies();
    expect(res.fields).toEqual([{ id: field.id, label: 'Machine number', categories: ['CS Accounts'] }]);
    expect(res.fieldsForAll).toBeGreaterThanOrEqual(1);
    expect((await applies(globex.id)).fields).toEqual([]);
  });
});

it('migration 093 round trip', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  expect((await qi.describeTable('Playbooks')).exceptCompanyIds).toBeUndefined();
  await migration.up(qi, Sequelize);
  await migration.up(qi, Sequelize);
  expect((await qi.describeTable('Playbooks')).exceptCompanyIds).toBeDefined();
});
