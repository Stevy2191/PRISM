const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('./fixtures');
const { createTicket } = require('../../src/services/tickets/ticketWrite');
const { getSystemActorUserId } = require('../../src/services/inboundEmailService');
const migration = require('../../migrations/20260101000085-ticket-category-unsure');

// Sub-project 9, task 2: required, with "Other / I'm not sure".

let w;
let alpha;
let empty;
let amy; // alpha's contact
let eve; // a contact of a company with no categories
let net;
let wifi;
const a = () => w.admin.agent;
const cat = async (body) => expectOk(await a().post(`${API}/ticket-categories`).send(body), 201).category;
// A ticket raised the way the portal and the agent raise them.
async function raise(contact, fields) {
  const actorId = await getSystemActorUserId();
  return createTicket({ id: actorId }, { title: 'Help', description: 'Please', contactId: contact.id, ...fields }, {
    createdById: actorId, source: 'portal', portal: { contact, raisedBy: contact }, requireCategory: true,
  });
}

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  empty = await makeCompany(w.admin, { name: 'Empty Co' });
  amy = await models.Contact.findByPk((await makeContact(w.admin, { companyId: alpha.id, firstName: 'Amy', lastName: 'Ng' })).id);
  eve = await models.Contact.findByPk((await makeContact(w.admin, { companyId: empty.id, firstName: 'Eve', lastName: 'Li' })).id);
  net = await cat({ name: 'Network', companyId: alpha.id, requireChild: true });
  wifi = await cat({ name: 'Wireless', parentId: net.id, companyId: alpha.id });
});
afterAll(closeDb);

it('the portal and agent need a choice when the company has categories, none when it has none', async () => {
  await expect(raise(amy, {})).rejects.toMatchObject({ status: 400, message: "Choose a category, or Other / I'm not sure" });
  const none = await raise(eve, {});
  expect(none.categoryId).toBeNull();
  expect(none.categoryUnsure).toBe(false);
  const full = await raise(amy, { categoryId: wifi.id });
  expect([full.categoryId, full.categoryUnsure]).toEqual([wifi.id, false]);
});

it('"not sure" at the top, and part way down (requireChild is skipped only then)', async () => {
  const top = await raise(amy, { categoryUnsure: true });
  expect([top.categoryId, top.categoryUnsure]).toEqual([null, true]);
  // Network needs a sub-category, unless the person wasn't sure beyond it.
  await expect(raise(amy, { categoryId: net.id })).rejects.toMatchObject({ status: 400 });
  const part = await raise(amy, { categoryId: net.id, categoryUnsure: true });
  expect([part.categoryId, part.categoryUnsure]).toEqual([net.id, true]);
  // Another company's category is refused, not sure or not.
  const other = await cat({ name: 'Elsewhere' });
  await expect(raise(amy, { categoryId: other.id, categoryUnsure: true })).rejects.toMatchObject({ status: 400 });
});

it('staff choosing a category settle it; the list filters what still needs triage', async () => {
  const unsure = await raise(amy, { categoryId: net.id, categoryUnsure: true });
  const sure = await raise(amy, { categoryId: wifi.id });
  const shown = (await a().get(`${API}/tickets/${unsure.id}`)).body.ticket;
  expect(shown.categoryUnsure).toBe(true);
  let list = (await a().get(`${API}/tickets`).query({ categoryUnsure: 'true' })).body.tickets.map((t) => t.id);
  expect(list).toEqual([unsure.id]);
  expectOk(await a().patch(`${API}/tickets/${unsure.id}`).send({ categoryId: wifi.id }));
  expect((await models.Ticket.findByPk(unsure.id)).categoryUnsure).toBe(false);
  list = (await a().get(`${API}/tickets`).query({ categoryUnsure: 'true' })).body.tickets;
  expect(list).toEqual([]);
  expect(sure.categoryUnsure).toBe(false);
});

it('the staff form\'s "require a category" setting only applies where the company has categories', async () => {
  await a().put(`${API}/ticket-categories/settings`).send({ categoryRequired: true });
  expect((await a().post(`${API}/tickets`).send({ title: 'x', contactId: amy.id })).status).toBe(400);
  await makeTicket(a(), { title: 'Fine', contactId: eve.id });
});

it('migration 085 down and up', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  try {
    expect((await qi.describeTable('Tickets')).categoryUnsure).toBeUndefined();
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize);
  expect((await qi.describeTable('Tickets')).categoryUnsure).toBeDefined();
});
