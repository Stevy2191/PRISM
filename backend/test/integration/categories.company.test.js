const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech, setCompanyAccess,
} = require('./fixtures');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const migration = require('../../migrations/20260101000084-company-ticket-categories');

// Sub-project 9, task 1: each company has its own ticket categories, never shared.

let w;
let alpha;
let beta;
let amy; // a contact of alpha
let bob; // a contact of beta
const a = () => w.admin.agent;
const cat = async (body) => expectOk(await a().post(`${API}/ticket-categories`).send(body), 201).category;
const listOf = async (companyId) => (await a().get(`${API}/ticket-categories`).query(companyId ? { companyId } : {})).body.categories;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  beta = await makeCompany(w.admin, { name: 'Beta Law' });
  amy = await makeContact(w.admin, { companyId: alpha.id, firstName: 'Amy', lastName: 'Ng' });
  bob = await makeContact(w.admin, { companyId: beta.id, firstName: 'Bob', lastName: 'Ray' });
});
afterAll(closeDb);

it('each company has its own tree: the same names side by side, listed apart', async () => {
  const internal = await cat({ name: 'Network' });
  const aNet = await cat({ name: 'Network', companyId: alpha.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  await cat({ name: 'Wireless', parentId: aNet.id, companyId: alpha.id });
  // Within a company the names are still unique.
  expect((await a().post(`${API}/ticket-categories`).send({ name: 'network', companyId: alpha.id })).status).toBe(409);
  expect(new Set([internal.companyId, aNet.companyId, bNet.companyId]).size).toBe(3);

  expect((await listOf(alpha.id)).map((c) => c.name).sort()).toEqual(['Network', 'Wireless']);
  expect((await listOf(beta.id)).map((c) => c.name)).toEqual(['Network']);
  // No company: Settings' own tree is the help desk's... when asked for it.
  const all = await listOf(null);
  expect(all).toHaveLength(4);
  expect(all.every((c) => typeof c.companyId === 'number')).toBe(true);
});

it('a parent must be of the same company; a category can\'t move to another company\'s branch', async () => {
  const aNet = await cat({ name: 'Network', companyId: alpha.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  expect((await a().post(`${API}/ticket-categories`).send({ name: 'Wifi', parentId: aNet.id, companyId: beta.id })).status).toBe(400);
  const bWifi = await cat({ name: 'Wifi', parentId: bNet.id, companyId: beta.id });
  expect((await a().patch(`${API}/ticket-categories/${bWifi.id}`).send({ parentId: aNet.id })).status).toBe(400);
  // Reordering one company's top level lists exactly its own.
  const aHw = await cat({ name: 'Hardware', companyId: alpha.id });
  expect((await a().post(`${API}/ticket-categories/reorder`).send({ companyId: alpha.id, parentId: null, orderedIds: [aHw.id, aNet.id] })).status).toBe(200);
  expect((await a().post(`${API}/ticket-categories/reorder`).send({ companyId: alpha.id, parentId: null, orderedIds: [aHw.id, aNet.id, bNet.id] })).status).toBe(400);
});

it('a staff user fenced to one company sees and changes only that company\'s categories', async () => {
  const aNet = await cat({ name: 'Network', companyId: alpha.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  const tech = await makeTech('tech-cat', w.deptA.id);
  await sequelize.query(
    "INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt) VALUES (:u, 'tickets.categories.manage', 1, NOW())",
    { replacements: { u: tech.user.id } }
  );
  invalidateAllPermissions();
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [alpha.id] });
  expect((await tech.agent.get(`${API}/ticket-categories`).query({ companyId: beta.id })).status).toBe(404);
  const mine = (await tech.agent.get(`${API}/ticket-categories`)).body.categories;
  expect(mine.map((c) => c.id)).toEqual([aNet.id]);
  expect((await tech.agent.patch(`${API}/ticket-categories/${bNet.id}`).send({ name: 'Mine now' })).status).toBe(404);
  expect((await tech.agent.delete(`${API}/ticket-categories/${bNet.id}`)).status).toBe(404);
  expect((await tech.agent.post(`${API}/ticket-categories`).send({ name: 'X', companyId: beta.id })).status).toBe(404);
  expect((await tech.agent.patch(`${API}/ticket-categories/${aNet.id}`).send({ name: 'Networking' })).status).toBe(200);
});

it('a ticket takes only its own company\'s category: create, update and bulk', async () => {
  const aNet = await cat({ name: 'Network', companyId: alpha.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  expect((await a().post(`${API}/tickets`).send({ title: 'x', contactId: amy.id, categoryId: bNet.id })).status).toBe(400);
  const t = await makeTicket(a(), { title: 'Wifi down', contactId: amy.id, categoryId: aNet.id });
  expect((await a().patch(`${API}/tickets/${t.id}`).send({ categoryId: bNet.id })).status).toBe(400);
  const bulk = await a().post(`${API}/tickets/bulk`).send({ action: 'category', value: bNet.id, ticketIds: [t.id] });
  expect((await models.Ticket.findByPk(t.id)).categoryId).toBe(aNet.id);
  expect(bulk.status).toBeLessThan(500);
});

it('moving a ticket to another company drops its old company\'s category, and logs it', async () => {
  const aNet = await cat({ name: 'Network', companyId: alpha.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  const t = await makeTicket(a(), { title: 'Wifi down', contactId: amy.id, categoryId: aNet.id });
  // Re-sending the old category with the new contact doesn't keep it.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ contactId: bob.id, categoryId: aNet.id }));
  let row = await models.Ticket.findByPk(t.id);
  expect(row.companyId).toBe(beta.id);
  expect(row.categoryId).toBeNull();
  // A new category of the new company is fine in the same change.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ contactId: amy.id, categoryId: aNet.id }));
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ contactId: bob.id, categoryId: bNet.id }));
  row = await models.Ticket.findByPk(t.id);
  expect(row.categoryId).toBe(bNet.id);
  // No category sent: still dropped.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ contactId: amy.id }));
  expect((await models.Ticket.findByPk(t.id)).categoryId).toBeNull();
  const activity = (await a().get(`${API}/tickets/${t.id}/activity`)).body;
  expect(JSON.stringify(activity)).toMatch(/categor/i);
});

it('recurring tickets take the contact\'s company\'s category; a run leaves off one of another company', async () => {
  const aNet = await cat({ name: 'Network', companyId: alpha.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  const base = {
    title: 'Weekly check', priority: 'low', type: 'task', contactId: amy.id,
    frequency: 'weekly', interval: 1, weekdays: [1], timeOfDay: '09:00', timezone: 'America/Chicago', startDate: '2026-01-05',
  };
  expect((await a().post(`${API}/recurring-tickets`).send({ ...base, categoryId: bNet.id })).status).toBe(400);
  const ok = await a().post(`${API}/recurring-tickets`).send({ ...base, categoryId: aNet.id });
  expect([200, 201]).toContain(ok.status);
  const rule = await models.RecurringTicket.findByPk(ok.body.rule.id);
  // The contact moves company afterwards; the run still makes the ticket.
  await models.Contact.update({ companyId: beta.id }, { where: { id: amy.id }, hooks: false });
  const { runRule } = require('../../src/services/recurring/runRule'); // eslint-disable-line global-require
  const ticket = await runRule(rule);
  expect(ticket.categoryId).toBeNull();
});

it('a company with categories can\'t be deleted; merging moves them, renaming clashing top-level ones', async () => {
  const gone = await makeCompany(w.admin, { name: 'Gamma' });
  await cat({ name: 'Printers', companyId: gone.id });
  expect((await a().delete(`${API}/companies/${gone.id}`)).status).toBe(409);
  await cat({ name: 'Printers', companyId: alpha.id });
  const gPhones = await cat({ name: 'Phones', companyId: gone.id });
  expectOk(await a().post(`${API}/companies/${gone.id}/merge`).send({ intoCompanyId: alpha.id }));
  const names = (await listOf(alpha.id)).map((c) => c.name).sort();
  expect(names).toEqual(['Phones', 'Printers', 'Printers (Gamma)']);
  expect((await models.TicketCategory.findByPk(gPhones.id)).companyId).toBe(alpha.id);
});

it('migration 084: existing categories belong to the internal company; down and up', async () => {
  const qi = sequelize.getQueryInterface();
  await cat({ name: 'Old' });
  await migration.down(qi, Sequelize);
  try {
    expect((await qi.describeTable('TicketCategories')).companyId).toBeUndefined();
    await sequelize.query("INSERT INTO TicketCategories (name, sortOrder, active, requireChild, createdAt, updatedAt) VALUES ('Older', 1, 1, 0, NOW(), NOW())");
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize); // idempotent
  const [internal] = await sequelize.query('SELECT id FROM Companies WHERE isInternal = 1', { type: Sequelize.QueryTypes.SELECT });
  const rows = await sequelize.query('SELECT name, companyId FROM TicketCategories ORDER BY name', { type: Sequelize.QueryTypes.SELECT });
  expect(rows).toEqual([{ name: 'Old', companyId: internal.id }, { name: 'Older', companyId: internal.id }]);
});
