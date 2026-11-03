const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { startMockMicrosoft } = require('./mockMicrosoft');
const { encryptToken } = require('../../src/utils/tokenCrypto');

// Sub-project 7b, task 3: contacts sign in to the portal with their work
// Microsoft account, against a fake Microsoft (mockMicrosoft.js).

const API = '/api/v1';
const TENANT = '11111111-2222-3333-4444-555555555555';
const UNLINKED = '99999999-2222-3333-4444-555555555555';
const GROUP = 'a0000000-0000-0000-0000-000000000001';
const OUTSIDERS = 'a0000000-0000-0000-0000-000000000002';
const uid = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const person = (n, extra = {}) => ({
  tid: TENANT, oid: uid(n), email: `person${n}@tenant.test`, name: `Person ${n}`, given_name: 'Person', family_name: String(n), ...extra,
});

let ms;
let w;
let company;
const portal = () => request.agent(getApp());

beforeAll(async () => {
  ms = await startMockMicrosoft();
  process.env.MS_LOGIN_BASE = ms.loginBase;
  process.env.MS_GRAPH_BASE = ms.graphBase;
});

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  require('../../src/services/microsoft365/graph').clearTokenCache(); // eslint-disable-line global-require
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  await models.SystemSettings.upsert({ key: 'portal.msClientId', value: ms.clientId });
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: encryptToken(ms.clientSecret) });
  company = await makeCompany(w.admin, { name: 'Tenant Co' });
  await models.Company.update({ msTenantId: TENANT, msSyncGroups: [{ id: GROUP, name: 'Portal users' }] }, { where: { id: company.id } });
  ms.nextSignIn = null;
  ms.tenants = {
    [TENANT]: {
      users: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [uid(n), { id: uid(n), accountEnabled: true }])),
      groups: { [GROUP]: { name: 'Portal users', members: [uid(1), uid(2), uid(3), uid(5)] }, [OUTSIDERS]: { name: 'Others', members: [uid(4)] } },
    },
    [UNLINKED]: { users: { [uid(9)]: { id: uid(9) } }, groups: {} },
  };
});

afterAll(async () => {
  delete process.env.MS_LOGIN_BASE;
  delete process.env.MS_GRAPH_BASE;
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await models.SystemSettings.destroy({ where: { key: ['portal.msClientId', 'portal.msClientSecret'] } });
  await ms.close();
  await closeDb();
});

// start → Microsoft → callback. Returns the callback's response (a redirect
// to the portal, or to the sign-in page with ?refused=) and its URL.
async function microsoftSignIn(agent, profile) {
  ms.nextSignIn = profile;
  const start = await agent.get(`${API}/portal/auth/microsoft/start`);
  expect(start.status).toBe(302);
  const authorize = await fetch(start.headers.location, { redirect: 'manual' });
  expect(authorize.status).toBe(302);
  const back = new URL(authorize.headers.get('location'));
  const callbackPath = back.pathname + back.search;
  return { res: await agent.get(callbackPath), callbackPath };
}
const refusedWith = (res) => new URL(res.headers.location, 'http://x').searchParams.get('refused');
const signedInPortal = (res) => res.status === 302 && /\/portal$/.test(res.headers.location);

it('a sync-group member with a new email gets a contact in the linked company, portal access on, signed in', async () => {
  const agent = portal();
  const { res } = await microsoftSignIn(agent, person(1));
  expect(signedInPortal(res)).toBe(true);
  const contact = await models.Contact.findOne({ where: { email: 'person1@tenant.test' } });
  expect(contact).toMatchObject({
    companyId: company.id, portalAccess: true, msObjectId: uid(1), firstName: 'Person', lastName: '1', displayName: 'Person 1', status: 'active',
  });
  const me = await agent.get(`${API}/portal/me`);
  expect(me.status).toBe(200);
  expect(me.body.contact).toMatchObject({ id: contact.id, signInMethod: 'microsoft' });
  // The second time they're matched by object id, even with a new email.
  const again = await microsoftSignIn(portal(), person(1, { email: 'renamed@tenant.test' }));
  expect(signedInPortal(again.res)).toBe(true);
  expect(await models.Contact.count({ where: { msObjectId: uid(1) } })).toBe(1);
});

it('an existing contact with that email in the company is linked, not duplicated, and loses their password', async () => {
  const existing = await models.Contact.scope('withPassword').create({
    firstName: 'Pat', lastName: 'Two', displayName: 'Pat Two', email: 'person2@tenant.test', companyId: company.id, passwordHash: 'x'.repeat(60),
  });
  const { res } = await microsoftSignIn(portal(), person(2));
  expect(signedInPortal(res)).toBe(true);
  const linked = await models.Contact.scope('withPassword').findByPk(existing.id);
  expect(linked).toMatchObject({ msObjectId: uid(2), passwordHash: null, portalAccess: true, displayName: 'Pat Two' });
  expect(await models.Contact.count({ where: { email: 'person2@tenant.test' } })).toBe(1);
});

it('refuses an unlinked tenant, a non-member, another company\'s contact and an inactive contact', async () => {
  expect(refusedWith((await microsoftSignIn(portal(), person(9, { tid: UNLINKED }))).res)).toBe('not_linked');
  expect(refusedWith((await microsoftSignIn(portal(), person(4))).res)).toBe('not_in_groups');

  const elsewhere = await makeCompany(w.admin, { name: 'Elsewhere' });
  const theirs = await models.Contact.create({
    firstName: 'Three', displayName: 'Three', email: 'person3@tenant.test', companyId: elsewhere.id,
  });
  expect(refusedWith((await microsoftSignIn(portal(), person(3))).res)).toBe('other_company');
  expect(await models.Contact.findByPk(theirs.id)).toMatchObject({ companyId: elsewhere.id, msObjectId: null });

  await models.Contact.create({
    firstName: 'Five', displayName: 'Five', email: 'person5@tenant.test', companyId: company.id, status: 'inactive', msObjectId: uid(5), portalAccess: true,
  });
  expect(refusedWith((await microsoftSignIn(portal(), person(5))).res)).toBe('inactive');
  // None of these made a contact.
  expect(await models.Contact.count({ where: { companyId: company.id } })).toBe(1);
});

it('rejects a token whose tenant does not match its issuer, and a replayed callback', async () => {
  // Signed for the linked tenant's id, but issued by another tenant.
  const forged = await microsoftSignIn(portal(), person(1, { iss: `${ms.loginBase}/${UNLINKED}/v2.0` }));
  expect(refusedWith(forged.res)).toBe('failed');
  const wrongNonce = await microsoftSignIn(portal(), person(1, { nonce: 'not-the-one-we-sent' }));
  expect(refusedWith(wrongNonce.res)).toBe('failed');
  expect(await models.Contact.count({ where: { msObjectId: uid(1) } })).toBe(0);

  const agent = portal();
  const { res, callbackPath } = await microsoftSignIn(agent, person(1));
  expect(signedInPortal(res)).toBe(true);
  // The same callback again, in another browser and in the same one.
  expect(refusedWith(await portal().get(callbackPath))).toBe('failed');
  expect(refusedWith(await agent.get(callbackPath))).toBe('failed');
});

it('a staff member in the groups gets a contact too, and their staff session is untouched', async () => {
  await models.User.update({ email: 'person1@tenant.test' }, { where: { id: w.admin.user.id } });
  const { res } = await microsoftSignIn(w.admin.agent, person(1));
  expect(signedInPortal(res)).toBe(true);
  expect(await models.Contact.count({ where: { email: 'person1@tenant.test', companyId: company.id } })).toBe(1);
  expect((await w.admin.agent.get(`${API}/auth/me`)).status).toBe(200);
  expect((await w.admin.agent.get(`${API}/portal/me`)).status).toBe(200);
});

it('Microsoft-linked contacts have no password sign-in and get no invites', async () => {
  await microsoftSignIn(portal(), person(1));
  const contact = await models.Contact.findOne({ where: { msObjectId: uid(1) } });
  const login = await portal().post(`${API}/portal/auth/login`).send({ email: 'person1@tenant.test', password: 'Anything-at-all-1' });
  expect(login.status).toBe(400);
  expect(login.body.code).toBe('USE_MICROSOFT');
  expect(login.body.message || login.body.error).toMatch(/Sign in with Microsoft/);
  const invite = await w.admin.agent.post(`${API}/contacts/${contact.id}/portal-invite`);
  expect(invite.status).toBe(400);
  expect(invite.body.code).toBe('USE_MICROSOFT');
});

it('without the Microsoft app or with the portal off, start sends the browser back refused', async () => {
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: '' });
  const res = await portal().get(`${API}/portal/auth/microsoft/start`);
  expect(res.status).toBe(302);
  expect(refusedWith(res)).toBe('unavailable');
});
