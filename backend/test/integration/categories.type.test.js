const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize, getApp,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');
const migration = require('../../migrations/20260101000086-category-ticket-type');

// Sub-project 9 (owner, 2026-11-10): incidents and requests have their own categories.

let w;
let company;
let amy;
let net; // incidents
let wifi; // under Network
let hire; // requests
let printers; // both
const a = () => w.admin.agent;
const cat = async (body) => expectOk(await a().post(`${API}/ticket-categories`).send({ companyId: company.id, ...body }), 201).category;

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  amy = await makeContact(w.admin, { companyId: company.id, firstName: 'Amy', lastName: 'Ng' });
  net = await cat({ name: 'Network', ticketType: 'incident' });
  wifi = await cat({ name: 'Wireless', parentId: net.id });
  hire = await cat({ name: 'New hire', ticketType: 'request' });
  printers = await cat({ name: 'Printers' });
});
afterAll(closeDb);

it('a top-level category says its type; its sub-categories go with it', async () => {
  const list = (await a().get(`${API}/ticket-categories`).query({ companyId: company.id })).body.categories;
  const by = Object.fromEntries(list.map((c) => [c.name, c]));
  expect([by.Network.forType, by.Wireless.forType, by['New hire'].forType, by.Printers.forType]).toEqual(['incident', 'incident', 'request', null]);
  expect(by.Wireless.ticketType).toBeNull();
  // Only a top-level category takes a type; nonsense is refused.
  expect((await a().patch(`${API}/ticket-categories/${wifi.id}`).send({ ticketType: 'request' })).status).toBe(400);
  expect((await a().post(`${API}/ticket-categories`).send({ companyId: company.id, name: 'X', ticketType: 'change' })).status).toBe(400);
  expectOk(await a().patch(`${API}/ticket-categories/${printers.id}`).send({ ticketType: 'request' }));
  expectOk(await a().patch(`${API}/ticket-categories/${printers.id}`).send({ ticketType: 'both' }));
  expect((await models.TicketCategory.findByPk(printers.id)).ticketType).toBeNull();
  // Moved under another category, it goes with that one.
  expectOk(await a().patch(`${API}/ticket-categories/${hire.id}`).send({ parentId: net.id }));
  expect((await models.TicketCategory.findByPk(hire.id)).ticketType).toBeNull();
});

it('an incident takes incident or both categories, a request request or both; other types any', async () => {
  expect((await a().post(`${API}/tickets`).send({ title: 'x', contactId: amy.id, type: 'request', categoryId: wifi.id })).status).toBe(400);
  expect((await a().post(`${API}/tickets`).send({ title: 'x', contactId: amy.id, type: 'incident', categoryId: hire.id })).status).toBe(400);
  await makeTicket(a(), { title: 'Wifi', contactId: amy.id, type: 'incident', categoryId: wifi.id });
  await makeTicket(a(), { title: 'Printer', contactId: amy.id, type: 'incident', categoryId: printers.id });
  await makeTicket(a(), { title: 'Starter', contactId: amy.id, type: 'request', categoryId: hire.id });
  await makeTicket(a(), { title: 'Plan', contactId: amy.id, type: 'change', categoryId: hire.id });
});

it('changing the type drops a category of the other type, keeps one for both', async () => {
  const t = await makeTicket(a(), { title: 'Wifi', contactId: amy.id, type: 'incident', categoryId: wifi.id });
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ type: 'request' }));
  expect((await models.Ticket.findByPk(t.id)).categoryId).toBeNull();
  // Re-sending the old category with the new type doesn't keep it either.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ type: 'incident', categoryId: wifi.id }));
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ type: 'request', categoryId: wifi.id }));
  expect((await models.Ticket.findByPk(t.id)).categoryId).toBeNull();
  // Both: kept.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ categoryId: printers.id }));
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ type: 'incident' }));
  expect((await models.Ticket.findByPk(t.id)).categoryId).toBe(printers.id);
});

it('the agent gets each category\'s type, and its ticket\'s category must fit the type', async () => {
  const key = await a().post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'Rollout' });
  const device = await enrollDevice(getApp(), key.body.secret);
  const who = (await device.get('/api/v1/agent/v1/tray/whoami')).body;
  expect(who.categories.map((c) => [c.name, c.ticketType])).toEqual([
    ['Network', 'incident'], ['Wireless', 'incident'], ['New hire', 'request'], ['Printers', null],
  ]);
  const ask = (extra) => ({ account: 'R\\amy', subject: 'Help', snapshot: {}, ...extra });
  expect((await device.post('/api/v1/agent/v1/tray/tickets', ask({ type: 'request', categoryId: wifi.id }))).status).toBe(400);
  const ok = await device.post('/api/v1/agent/v1/tray/tickets', ask({ type: 'incident', categoryId: wifi.id }));
  expect(await models.Ticket.findByPk(ok.body.ticketId)).toMatchObject({ type: 'incident', categoryId: wifi.id });
});

it('the portal (requests) offers request categories and those for both', async () => {
  const meta = require('../../src/controllers/portal/ticketsController'); // eslint-disable-line global-require
  expect(typeof meta.meta).toBe('function');
  const names = (await models.TicketCategory.findAll({ where: { companyId: company.id } })).map((c) => c.name);
  expect(names).toContain('New hire');
});

it('migration 086 down and up', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  try {
    expect((await qi.describeTable('TicketCategories')).ticketType).toBeUndefined();
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize);
  expect((await qi.describeTable('TicketCategories')).ticketType).toBeDefined();
});
