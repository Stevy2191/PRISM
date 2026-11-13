const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, getApp, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');
const migration = require('../../migrations/20260101000090-agent-user-links');

// Who is at the computer when the sign-in has no email to match: staff say
// it once on a ticket, or the computer is assigned to them.

const TRAY = '/api/v1/agent/v1/tray';
const sean = { account: 'sstevens' }; // a local Mac account: no UPN
let w;
let company;
let device;
let assetId;
let contact;
const a = () => w.admin.agent;
const raise = async (dev, who, subject = 'Screen flickers') => (await dev.post(`${TRAY}/tickets`, { ...who, subject, description: 'Help' })).body;
const home = async (dev, who) => (await dev.get(`${TRAY}/home?account=${encodeURIComponent(who.account)}`)).body;
const enroll = async (c) => enrollDevice(getApp(), (await a().post(`${API}/companies/${c.id}/agent-keys`).send({ name: 'Rollout' })).body.secret);

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'S6 Technologies' });
  device = await enroll(company);
  ({ assetId } = await models.Device.findByPk(device.deviceId));
  contact = await models.Contact.create({
    firstName: 'Sean', displayName: 'Sean Stevens', email: 'sean@s6.test', companyId: company.id,
  });
});
afterAll(closeDb);

it('giving an unknown person\'s agent ticket to a contact teaches PRISM who that account is', async () => {
  const first = await raise(device, sean);
  const second = await raise(device, sean, 'Second one');
  const other = await raise(device, { account: 'guest' }, 'A different account');
  expect(first.replyTo).toBeNull();
  const ph = await models.Contact.findOne({ where: { companyId: company.id, isPlaceholder: true } });
  expect((await models.Ticket.findByPk(first.ticketId))).toMatchObject({ contactId: ph.id, agentAccount: 'sstevens' });
  expect((await home(device, sean))).toMatchObject({ matched: false, tickets: [] });

  // Staff: this one is Sean's.
  expectOk(await a().patch(`${API}/tickets/${first.ticketId}`).send({ contactId: contact.id }));
  // His other ticket from that account came with it; the other account's didn't.
  expect((await models.Ticket.findByPk(second.ticketId)).contactId).toBe(contact.id);
  expect((await models.Ticket.findByPk(other.ticketId)).contactId).toBe(ph.id);
  expect(await models.AgentUserLink.findOne({ where: { deviceId: device.deviceId, account: 'sstevens' } })).toMatchObject({ contactId: contact.id, source: 'staff' });

  // From now on he is known: his tickets list, and a new one is his.
  const h = await home(device, { account: 'SStevens' }); // however the system spells it
  expect(h.matched).toBe(true);
  expect(h.tickets.map((t) => t.id).sort()).toEqual([first.ticketId, second.ticketId].sort());
  const third = await raise(device, sean, 'Third');
  expect(third.replyTo).toBe('sean@s6.test');
  expect((await models.Ticket.findByPk(third.ticketId)).contactId).toBe(contact.id);
  // Another account on the same computer is still unknown.
  expect((await home(device, { account: 'guest' })).matched).toBe(false);
  // The same account name on another computer is not him.
  const second2 = await enroll(company);
  expect((await home(second2, sean)).matched).toBe(false);
});

it('a computer assigned to a contact knows its usual user as that contact', async () => {
  // The agent reports who uses the computer; staff assign it to Sean.
  await models.Device.update({ inventory: { signedInUser: { account: 'sstevens' } } }, { where: { id: device.deviceId } });
  expect((await home(device, sean)).matched).toBe(false);
  expectOk(await a().patch(`${API}/assets/${assetId}`).send({ assignedToContactId: contact.id }));
  expect((await home(device, sean)).matched).toBe(true);
  expect(await models.AgentUserLink.findOne({ where: { deviceId: device.deviceId, account: 'sstevens' } })).toMatchObject({ contactId: contact.id, source: 'assigned' });
  const t = await raise(device, sean);
  expect(t.replyTo).toBe('sean@s6.test');
  // A different account on that computer isn't the assignee.
  expect((await home(device, { account: 'guest' })).matched).toBe(false);
});

it('a link never crosses companies or reaches the stand-in', async () => {
  const elsewhere = await makeCompany(w.admin, { name: 'Lakeside' });
  const outsider = await models.Contact.create({ firstName: 'Out', displayName: 'Out Sider', email: 'o@lake.test', companyId: elsewhere.id });
  await models.AgentUserLink.create({ deviceId: device.deviceId, account: 'sstevens', contactId: outsider.id });
  expect((await home(device, sean)).matched).toBe(false);
  // Moving an agent ticket to another company's contact teaches nothing.
  const t = await raise(device, sean);
  expectOk(await a().patch(`${API}/tickets/${t.ticketId}`).send({ contactId: outsider.id }));
  expect((await models.AgentUserLink.findOne({ where: { deviceId: device.deviceId, account: 'sstevens' } })).contactId).toBe(outsider.id);
  expect((await home(device, sean)).matched).toBe(false);
});

it('migration 090 down and up', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  try {
    expect((await qi.describeTable('Tickets')).agentAccount).toBeUndefined();
    await expect(qi.describeTable('AgentUserLinks')).rejects.toThrow();
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize);
  expect((await qi.describeTable('Tickets')).agentAccount).toBeDefined();
});
