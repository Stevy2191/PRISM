const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { API, expectOk, makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');

// Sub-project 9, task 7: the agent's Submit a ticket window asks the type
// and the company's category (or Other / I'm not sure).

const TICKETS = '/api/v1/agent/v1/tray/tickets';
const WHOAMI = '/api/v1/agent/v1/tray/whoami';
let w;
let company;
let other;
let device;
const ask = (extra = {}) => ({
  account: 'RIVERSIDE\\mchen', subject: 'Wifi drops', description: 'All morning', snapshot: {}, ...extra,
});
const cat = async (body) => expectOk(await w.admin.agent.post(`${API}/ticket-categories`).send(body), 201).category;

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  other = await makeCompany(w.admin, { name: 'Lakeside' });
  const res = await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'Rollout' });
  device = await enrollDevice(getApp(), res.body.secret);
});
afterAll(closeDb);

it('whoami carries only the device\'s company\'s active categories, trimmed', async () => {
  const net = await cat({ name: 'Network', companyId: company.id, requireChild: true });
  await cat({ name: 'Wireless', parentId: net.id, companyId: company.id });
  const old = await cat({ name: 'Fax', companyId: company.id });
  await w.admin.agent.patch(`${API}/ticket-categories/${old.id}`).send({ active: false });
  await cat({ name: 'Theirs', companyId: other.id });
  await cat({ name: 'Help desk own' });
  const res = await device.get(WHOAMI);
  expect(res.status).toBe(200);
  expect(res.body.categories).toEqual([
    { id: net.id, parentId: null, name: 'Network', requireChild: true, ticketType: null },
    { id: expect.any(Number), parentId: net.id, name: 'Wireless', requireChild: false, ticketType: null },
  ]);
});

it('the type and a category of the device\'s company reach the ticket', async () => {
  const net = await cat({ name: 'Network', companyId: company.id, requireChild: true });
  const wifi = await cat({ name: 'Wireless', parentId: net.id, companyId: company.id });
  const res = await device.post(TICKETS, ask({ type: 'incident', categoryId: wifi.id }));
  expect(res.status).toBe(201);
  expect(await models.Ticket.findByPk(res.body.ticketId)).toMatchObject({ type: 'incident', categoryId: wifi.id, categoryUnsure: false });
  // "Not sure" part way down, as a request.
  const res2 = await device.post(TICKETS, ask({ type: 'request', categoryId: net.id, categoryUnsure: true }));
  expect(await models.Ticket.findByPk(res2.body.ticketId)).toMatchObject({ type: 'request', categoryId: net.id, categoryUnsure: true });
  // Any other type is a request.
  const res3 = await device.post(TICKETS, ask({ type: 'change', categoryUnsure: true }));
  expect(await models.Ticket.findByPk(res3.body.ticketId)).toMatchObject({ type: 'request', categoryId: null, categoryUnsure: true });
});

it('another company\'s category is refused; a sub-category is still required unless not sure', async () => {
  const theirs = await cat({ name: 'Theirs', companyId: other.id });
  expect((await device.post(TICKETS, ask({ categoryId: theirs.id }))).status).toBe(400);
  const net = await cat({ name: 'Network', companyId: company.id, requireChild: true });
  await cat({ name: 'Wireless', parentId: net.id, companyId: company.id });
  expect((await device.post(TICKETS, ask({ categoryId: net.id }))).status).toBe(400);
  expect(await models.Ticket.count({ where: { source: 'agent' } })).toBe(0);
});

it('an agent from before (no type, no category) can always raise a ticket: a request, marked not sure', async () => {
  await cat({ name: 'Network', companyId: company.id });
  const res = await device.post(TICKETS, ask());
  expect(res.status).toBe(201);
  expect(await models.Ticket.findByPk(res.body.ticketId)).toMatchObject({ type: 'request', categoryId: null, categoryUnsure: true });
  // A company with no categories: nothing to be unsure about.
  await models.TicketCategory.destroy({ where: { companyId: company.id } });
  const res2 = await device.post(TICKETS, ask());
  expect(await models.Ticket.findByPk(res2.body.ticketId)).toMatchObject({ categoryId: null, categoryUnsure: false });
});
