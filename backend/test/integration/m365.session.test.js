const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  makeWorld, makeCompany, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const { startMockMicrosoft } = require('./mockMicrosoft');
const {
  TENANT, GROUP, uid, person, microsoftSignIn,
} = require('./m365Fixtures');
const { encryptToken } = require('../../src/utils/tokenCrypto');

// Sub-project 7b, task 4: a Microsoft portal session re-checks the person
// with Microsoft at least every 15 minutes.

const API = '/api/v1';
const MINUTE = 60 * 1000;

let ms;
let company;
let agent;
let contactId;
const graphCalls = () => ms.requests.filter((r) => r.includes('/v1.0/')).length;

beforeAll(async () => {
  ms = await startMockMicrosoft();
  process.env.MS_LOGIN_BASE = ms.loginBase;
  process.env.MS_GRAPH_BASE = ms.graphBase;
});

beforeEach(async () => {
  await resetData();
  const w = await makeWorld();
  require('../../src/services/microsoft365/graph').clearTokenCache(); // eslint-disable-line global-require
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  await models.SystemSettings.upsert({ key: 'portal.msClientId', value: ms.clientId });
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: encryptToken(ms.clientSecret) });
  company = await makeCompany(w.admin, { name: 'Tenant Co' });
  await models.Company.update({ msTenantId: TENANT, msSyncGroups: [{ id: GROUP, name: 'Portal users' }] }, { where: { id: company.id } });
  ms.failures = [];
  ms.tenants = {
    [TENANT]: {
      users: { [uid(1)]: { id: uid(1), accountEnabled: true } },
      groups: { [GROUP]: { name: 'Portal users', members: [uid(1)] } },
    },
  };
  freezeClock(new Date().toISOString());
  agent = request.agent(getApp());
  await microsoftSignIn(ms, agent, person(1));
  contactId = (await models.Contact.findOne({ where: { msObjectId: uid(1) } })).id;
  ms.requests = [];
});

afterEach(unfreezeClock);

afterAll(async () => {
  delete process.env.MS_LOGIN_BASE;
  delete process.env.MS_GRAPH_BASE;
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await models.SystemSettings.destroy({ where: { key: ['portal.msClientId', 'portal.msClientSecret'] } });
  await ms.close();
  await closeDb();
});

it('asks Microsoft nothing within 15 minutes of the last check', async () => {
  advanceClock(14 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(200);
  expect(graphCalls()).toBe(0);
});

it('after 15 minutes a still-allowed person is checked once, then not again for another 15', async () => {
  advanceClock(16 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(200);
  const calls = graphCalls();
  expect(calls).toBeGreaterThan(0);
  advanceClock(5 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(200);
  expect(graphCalls()).toBe(calls);
});

it('a person disabled in Microsoft is signed out on their next request after 15 minutes, and made inactive', async () => {
  ms.tenants[TENANT].users[uid(1)].accountEnabled = false;
  advanceClock(16 * MINUTE);
  const res = await agent.get(`${API}/portal/me`);
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('PORTAL_ACCESS_ENDED');
  expect((await models.Contact.findByPk(contactId)).status).toBe('inactive');
  const [audit] = await models.AuditLog.findAll({ where: { action: 'portal.access_ended_by_directory' } });
  expect(audit).toBeTruthy();
  expect((await agent.get(`${API}/portal/me`)).status).toBe(401);
});

it('a person removed from every sync group, or deleted, is signed out and made inactive', async () => {
  ms.tenants[TENANT].groups[GROUP].members = [];
  advanceClock(16 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(401);
  expect((await models.Contact.findByPk(contactId)).status).toBe('inactive');
});

it('a tenant unlinked from the company ends the session but leaves the contact active', async () => {
  await models.Company.update({ msTenantId: null }, { where: { id: company.id } });
  advanceClock(16 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(401);
  expect((await models.Contact.findByPk(contactId)).status).toBe('active');
});

it('a Microsoft outage keeps the session; the check is tried again a minute later', async () => {
  ms.failures = Array.from({ length: 8 }, () => ({ match: /\/v1\.0\//, status: 503, retryAfter: 0 }));
  advanceClock(16 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(200);
  ms.failures = [];
  ms.requests = [];
  expect((await agent.get(`${API}/portal/me`)).status).toBe(200);
  expect(graphCalls()).toBe(0); // backing off
  ms.tenants[TENANT].users[uid(1)].accountEnabled = false;
  advanceClock(2 * MINUTE);
  expect((await agent.get(`${API}/portal/me`)).status).toBe(401);
});
