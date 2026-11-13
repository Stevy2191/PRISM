const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, getApp, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeTech, makeTicket, setCompanyAccess,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');
const migration = require('../../migrations/20260101000088-agent-notices');

// The agent window's home: notices, the person's tickets from this
// computer, a ticket's conversation and a reply.

const TRAY = '/api/v1/agent/v1/tray';
const WHO = 'account=RIVERSIDE%5Cmchen&upn=maria.chen%40riversideclinic.org';
const who = { account: 'RIVERSIDE\\mchen', upn: 'maria.chen@riversideclinic.org' };
let w;
let company;
let other;
let device;
let maria;
const a = () => w.admin.agent;
const raise = async (dev, extra = {}) => (await dev.post(`${TRAY}/tickets`, { ...who, subject: 'Printer offline', description: 'It shows offline.', ...extra })).body.ticketId;
const enroll = async (c) => enrollDevice(getApp(), (await a().post(`${API}/companies/${c.id}/agent-keys`).send({ name: 'Rollout' })).body.secret);
const contactIn = (c, email, name) => models.Contact.create({
  firstName: name, displayName: name, email, companyId: c.id,
});

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  other = await makeCompany(w.admin, { name: 'Lakeside' });
  device = await enroll(company);
  maria = await contactIn(company, 'maria.chen@riversideclinic.org', 'Maria Chen');
});
afterAll(closeDb);

it('home lists the person\'s tickets from this computer, with plain states and the last staff reply', async () => {
  const first = await raise(device);
  const second = await raise(device, { subject: 'Screen flickers' });
  // A ticket of hers that didn't come from this computer stays in the portal.
  const emailed = await makeTicket(a(), { title: 'Emailed in', contactId: maria.id });
  expectOk(await a().post(`${API}/tickets/${first}/comments`).send({ body: 'Which room are you in?', type: 'reply' }), 201);
  expectOk(await a().post(`${API}/tickets/${first}/comments`).send({ body: 'Staff only', type: 'comment_private' }), 201);
  const closed = (await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } })).name;
  await models.Ticket.update({ status: closed }, { where: { id: second } });

  const res = await device.get(`${TRAY}/home?${WHO}`);
  expect(res.status).toBe(200);
  expect(res.body.matched).toBe(true);
  const byId = Object.fromEntries(res.body.tickets.map((t) => [t.id, t]));
  expect(Object.keys(byId).map(Number).sort()).toEqual([first, second].sort());
  expect(byId[emailed.id]).toBeUndefined();
  expect(byId[first]).toMatchObject({ number: String(first).padStart(5, '0'), title: 'Printer offline', lastReply: { snippet: 'Which room are you in?' } });
  expect(byId[second]).toMatchObject({ state: 'done', lastReply: null });
  expect(JSON.stringify(res.body)).not.toContain('Staff only');
  expect(JSON.stringify(res.body)).not.toContain('Health snapshot');
});

it('someone who matches no contact, or another contact, sees no tickets', async () => {
  await raise(device);
  const stranger = await device.get(`${TRAY}/home?account=RIVERSIDE%5Cbob`);
  expect(stranger.body).toMatchObject({ matched: false, tickets: [] });
  await contactIn(company, 'tom@riversideclinic.org', 'Tom');
  const tom = await device.get(`${TRAY}/home?account=x&upn=tom%40riversideclinic.org`);
  expect(tom.body).toMatchObject({ matched: true, tickets: [] });
});

it('a ticket opens with its public conversation only; another computer or person gets not found', async () => {
  const id = await raise(device);
  expectOk(await a().post(`${API}/tickets/${id}/comments`).send({ body: 'Which room?', type: 'reply' }), 201);
  expectOk(await a().post(`${API}/tickets/${id}/comments`).send({ body: 'Staff only', type: 'comment_private' }), 201);
  const res = await device.get(`${TRAY}/tickets/${id}?${WHO}`);
  expect(res.status).toBe(200);
  expect(res.body.ticket).toMatchObject({ id, title: 'Printer offline', description: 'It shows offline.', state: 'open' });
  expect(res.body.messages.map((m) => [m.side, m.body])).toEqual([['support', 'Which room?']]);

  const second = await enroll(company);
  expect((await second.get(`${TRAY}/tickets/${id}?${WHO}`)).status).toBe(404);
  const elsewhere = await enroll(other);
  expect((await elsewhere.get(`${TRAY}/tickets/${id}?${WHO}`)).status).toBe(404);
  await contactIn(company, 'tom@riversideclinic.org', 'Tom');
  expect((await device.get(`${TRAY}/tickets/${id}?account=x&upn=tom%40riversideclinic.org`)).status).toBe(404);
  expect((await device.get(`${TRAY}/tickets/999999?${WHO}`)).status).toBe(404);
  expect((await device.get(`${TRAY}/tickets/abc?${WHO}`)).status).toBe(404);
});

it('a reply from the agent is the contact\'s own reply, like one from the portal', async () => {
  const id = await raise(device);
  const res = await device.post(`${TRAY}/tickets/${id}/reply`, { ...who, body: '  Room 4, by the window.  ' });
  expect(res.status).toBe(201);
  const c = await models.Comment.findByPk(res.body.id);
  expect(c).toMatchObject({
    ticketId: id, type: 'reply', fromCustomer: true, authorContactId: maria.id, body: 'Room 4, by the window.',
  });
  const view = await device.get(`${TRAY}/tickets/${id}?${WHO}`);
  expect(view.body.messages.map((m) => [m.side, m.from, m.body])).toEqual([['you', 'You', 'Room 4, by the window.']]);
  // The ticket moved to User responded, as a portal reply moves it.
  const status = await models.TicketStatus.findOne({ where: { systemKey: 'user_responded' } });
  if (status) expect((await models.Ticket.findByPk(id)).status).toBe(status.name);

  expect((await device.post(`${TRAY}/tickets/${id}/reply`, { ...who, body: '   ' })).status).toBe(400);
  expect((await device.post(`${TRAY}/tickets/${id}/reply`, { ...who, body: 'x'.repeat(10001) })).status).toBe(400);
  const second = await enroll(company);
  expect((await second.post(`${TRAY}/tickets/${id}/reply`, { ...who, body: 'Not mine' })).status).toBe(404);
  expect((await device.post(`${TRAY}/tickets/${id}/reply`, { account: 'RIVERSIDE\\bob', body: 'Not matched' })).status).toBe(404);
  expect(await models.Comment.count({ where: { ticketId: id, type: 'reply' } })).toBe(1);
});

it('notices: for the company or everyone, until they expire or are taken down', async () => {
  const mine = expectOk(await a().post(`${API}/agent-notices`).send({ companyId: company.id, headline: 'Email is slow', message: 'We are on it.' }), 201).notice;
  expectOk(await a().post(`${API}/agent-notices`).send({ companyId: other.id, headline: 'Lakeside only' }), 201);
  const all = expectOk(await a().post(`${API}/agent-notices`).send({ companyId: null, headline: 'Maintenance tonight', expiresAt: new Date(Date.now() + 3600e3).toISOString() }), 201).notice;
  let { notices } = (await device.get(`${TRAY}/home?${WHO}`)).body;
  expect(notices.map((n) => n.headline).sort()).toEqual(['Email is slow', 'Maintenance tonight']);
  expect(notices.find((n) => n.id === mine.id)).toMatchObject({ message: 'We are on it.' });
  // Someone who matches no contact still sees notices.
  expect((await device.get(`${TRAY}/home?account=RIVERSIDE%5Cbob`)).body.notices).toHaveLength(2);

  await models.AgentNotice.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: all.id } });
  expectOk(await a().delete(`${API}/agent-notices/${mine.id}`));
  ({ notices } = (await device.get(`${TRAY}/home?${WHO}`)).body);
  expect(notices).toEqual([]);
  expect((await a().delete(`${API}/agent-notices/${mine.id}`)).status).toBe(404);
  expect(await models.AuditLog.count({ where: { action: ['agent.notice_posted', 'agent.notice_removed'] } })).toBe(4);
});

it('notices: validation, permission and the company fence', async () => {
  const post = (agent, body) => agent.post(`${API}/agent-notices`).send(body);
  expect((await post(a(), { companyId: company.id })).status).toBe(400);
  expect((await post(a(), { companyId: company.id, headline: 'x'.repeat(121) })).status).toBe(400);
  expect((await post(a(), { companyId: company.id, headline: 'Ok', message: 'm'.repeat(501) })).status).toBe(400);
  expect((await post(a(), { companyId: company.id, headline: 'Ok', expiresAt: 'soon' })).status).toBe(400);
  expect((await post(a(), { companyId: company.id, headline: 'Ok', expiresAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
  expect((await post(a(), { companyId: 999999, headline: 'Ok' })).status).toBe(404);

  const tech = await makeTech('tech-notice', w.deptA.id);
  expect((await post(tech.agent, { companyId: company.id, headline: 'No' })).status).toBe(403);
  await sequelize.query(
    "INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt) VALUES (:u, 'devices.manage', 1, NOW())",
    { replacements: { u: tech.user.id } }
  );
  require('../../src/services/permissionService').invalidateAllPermissions(); // eslint-disable-line global-require
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [company.id] });
  expect((await post(tech.agent, { companyId: other.id, headline: 'Not mine' })).status).toBe(404);
  expect((await post(tech.agent, { companyId: null, headline: 'Everyone' })).status).toBe(403);
  const ok = expectOk(await post(tech.agent, { companyId: company.id, headline: 'Mine' }), 201).notice;
  const theirs = expectOk(await post(a(), { companyId: other.id, headline: 'Lakeside' }), 201).notice;
  const everyone = expectOk(await post(a(), { companyId: null, headline: 'All' }), 201).notice;
  expect((await tech.agent.delete(`${API}/agent-notices/${theirs.id}`)).status).toBe(404);
  expect((await tech.agent.delete(`${API}/agent-notices/${everyone.id}`)).status).toBe(404);
  const listed = expectOk(await tech.agent.get(`${API}/agent-notices`).query({ companyId: company.id }));
  expect(listed.notices.map((n) => n.id).sort()).toEqual([ok.id, everyone.id].sort());
  expect(listed.canPostToAll).toBe(false);
  expect((await tech.agent.get(`${API}/agent-notices`).query({ companyId: other.id })).status).toBe(404);
});

it('migration 088 down and up', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  try {
    await expect(qi.describeTable('AgentNotices')).rejects.toThrow();
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize);
  expect(Object.keys(await qi.describeTable('AgentNotices'))).toEqual(expect.arrayContaining(['companyId', 'headline', 'expiresAt', 'removedAt']));
});
