const {
  resetData, closeDb, models, createUserAndLogin, ROLE,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { startMockMicrosoft } = require('./mockMicrosoft');
const { TENANT, GROUP, uid } = require('./m365Fixtures');
const { encryptToken } = require('../../src/utils/tokenCrypto');
const { syncCompany, immutableIdToGuidHex } = require('../../src/services/microsoft365/sync');
const { runChecks, tonightsRunAt } = require('../../src/services/microsoft365/syncScheduler');

// Sub-project 7b, task 5: the nightly and on-demand Microsoft 365 sync.

const API = '/api/v1';
const SECOND_GROUP = 'a0000000-0000-0000-0000-000000000009';
const GUID_BYTES = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const graphUser = (n, extra = {}) => ({
  id: uid(n),
  displayName: `Person ${n}`,
  givenName: 'Person',
  surname: String(n),
  mail: `person${n}@tenant.test`,
  userPrincipalName: `person${n}@tenant.test`,
  accountEnabled: true,
  department: 'Billing',
  jobTitle: 'Clerk',
  businessPhones: [],
  mobilePhone: null,
  onPremisesImmutableId: null,
  ...extra,
});

let ms;
let w;
let company;
const contact = (fields) => models.Contact.scope('withPassword').create({
  firstName: 'Old', lastName: 'Name', displayName: 'Old Name', companyId: company.id, ...fields,
});
const reload = (c) => models.Contact.scope('withPassword').findByPk(c.id);

beforeAll(async () => {
  ms = await startMockMicrosoft();
  process.env.MS_LOGIN_BASE = ms.loginBase;
  process.env.MS_GRAPH_BASE = ms.graphBase;
});

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  require('../../src/services/microsoft365/graph').clearTokenCache(); // eslint-disable-line global-require
  await models.SystemSettings.upsert({ key: 'portal.msClientId', value: ms.clientId });
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: encryptToken(ms.clientSecret) });
  company = await makeCompany(w.admin, { name: 'Tenant Co' });
  await models.Company.update({ msTenantId: TENANT, msSyncGroups: [{ id: GROUP, name: 'Portal users' }] }, { where: { id: company.id } });
  ms.failures = [];
  ms.requests = [];
  ms.tenants = {
    [TENANT]: {
      users: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [uid(n), graphUser(n)])),
      // Five members: three pages of two.
      groups: { [GROUP]: { name: 'Portal users', members: [1, 2, 3, 4, 5].map(uid) }, [SECOND_GROUP]: { name: 'Others', members: [uid(6)] } },
    },
  };
});

afterAll(async () => {
  delete process.env.MS_LOGIN_BASE;
  delete process.env.MS_GRAPH_BASE;
  await models.SystemSettings.destroy({ where: { key: ['portal.msClientId', 'portal.msClientSecret'] } });
  await ms.close();
  await closeDb();
});

it('links by email and by AD GUID, never creates a contact, and reads every page', async () => {
  const byEmail = await contact({ email: 'PERSON1@tenant.test', passwordHash: 'x'.repeat(60) });
  ms.tenants[TENANT].users[uid(2)].onPremisesImmutableId = GUID_BYTES.toString('base64');
  const byGuid = await contact({ email: 'someone.else@tenant.test', adObjectGUID: GUID_BYTES.toString('hex') });
  const before = await models.Contact.count();

  const result = await syncCompany(company.id);
  expect(result.errors).toEqual([]);
  expect(await reload(byEmail)).toMatchObject({ msObjectId: uid(1), portalAccess: true, passwordHash: null });
  expect(await reload(byGuid)).toMatchObject({ msObjectId: uid(2), email: 'person2@tenant.test' });
  expect(await models.Contact.count()).toBe(before);
  expect(ms.requests.filter((r) => r.includes('/transitiveMembers/'))).toHaveLength(3);
  expect(immutableIdToGuidHex(GUID_BYTES.toString('base64'))).toBe('00112233445566778899aabbccddeeff');
});

it('updates name, email, phone (business, else mobile), job title and department name', async () => {
  const c3 = await contact({ email: 'old3@tenant.test', msObjectId: uid(3) });
  const c4 = await contact({ email: 'old4@tenant.test', msObjectId: uid(4), phone: '111' });
  Object.assign(ms.tenants[TENANT].users[uid(3)], { businessPhones: ['+1 555 0100'], mobilePhone: '+1 555 0199', department: 'Front Desk', jobTitle: 'Receptionist' });
  Object.assign(ms.tenants[TENANT].users[uid(4)], { mobilePhone: '+1 555 0400' });
  const result = await syncCompany(company.id);
  expect(await reload(c3)).toMatchObject({
    firstName: 'Person', lastName: '3', displayName: 'Person 3', email: 'person3@tenant.test', phone: '+1 555 0100', jobTitle: 'Receptionist', msDepartmentName: 'Front Desk',
  });
  expect((await reload(c4)).phone).toBe('+1 555 0400');
  expect(result.updated).toBe(2);
  // Nothing changed: nothing updated.
  expect((await syncCompany(company.id)).updated).toBe(0);
});

it('makes disabled people and people outside the sync groups inactive, keeping their records', async () => {
  const disabled = await contact({ email: 'p4@tenant.test', msObjectId: uid(4) });
  const leaver = await contact({ email: 'p6@tenant.test', msObjectId: uid(6) });
  const unlinked = await contact({ email: 'nobody@tenant.test' });
  ms.tenants[TENANT].users[uid(4)].accountEnabled = false;
  const result = await syncCompany(company.id);
  expect(result.deactivated).toBe(2);
  expect((await reload(disabled)).status).toBe('inactive');
  expect((await reload(leaver)).status).toBe('inactive');
  expect((await reload(unlinked)).status).toBe('active');
  expect(await models.AuditLog.count({ where: { action: 'portal.access_ended_by_directory' } })).toBe(2);
});

it('withdrawn consent (403) is recorded on the last sync and nobody is made inactive', async () => {
  const leaver = await contact({ email: 'p6@tenant.test', msObjectId: uid(6) });
  ms.failures = [{ match: /transitiveMembers/, status: 403, code: 'Authorization_RequestDenied' }];
  const result = await syncCompany(company.id);
  expect(result.deactivated).toBe(0);
  expect(result.errors[0]).toMatch(/Portal users.*403/);
  expect((await reload(leaver)).status).toBe('active');
  expect((await models.Company.findByPk(company.id)).msLastSync).toMatchObject({ deactivated: 0, errors: result.errors });
});

it('two people with one contact\'s email, or an email another contact has: one links, the rest are errors', async () => {
  ms.tenants[TENANT].users[uid(5)].mail = 'person1@tenant.test';
  ms.tenants[TENANT].users[uid(5)].userPrincipalName = 'person1@tenant.test';
  const shared = await contact({ email: 'person1@tenant.test' });
  // An Entra email change onto an address another contact already has.
  const c3 = await contact({ email: 'old3@tenant.test', msObjectId: uid(3) });
  await contact({ email: 'person3@tenant.test' });
  const result = await syncCompany(company.id);
  expect((await reload(shared)).msObjectId).toBe(uid(1));
  expect(result.errors).toHaveLength(2);
  expect(result.errors.join('\n')).toMatch(/already linked to another Microsoft person/);
  expect(result.errors.join('\n')).toMatch(/person3@tenant.test is already another contact's/);
  expect((await reload(c3)).email).toBe('old3@tenant.test');
});

it('runs one sync per company at a time', async () => {
  const [a, b] = await Promise.allSettled([syncCompany(company.id), syncCompany(company.id)]);
  expect(a.status).toBe('fulfilled');
  expect(b).toMatchObject({ status: 'rejected', reason: { status: 409, code: 'SYNC_RUNNING' } });
});

it('staff link a tenant, pick groups, get the approval link and Sync now; others cannot', async () => {
  const other = await makeCompany(w.admin, { name: 'Other Co' });
  let res = await w.admin.agent.put(`${API}/companies/${other.id}/m365`).send({ tenantId: TENANT });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('TENANT_IN_USE');
  res = await w.admin.agent.put(`${API}/companies/${other.id}/m365`).send({ tenantId: 'not-a-guid' });
  expect(res.status).toBe(400);

  res = await w.admin.agent.get(`${API}/companies/${company.id}/m365/groups?q=others`);
  expect(res.status).toBe(200);
  expect(res.body.groups).toEqual([{ id: SECOND_GROUP, name: 'Others' }]);
  expect((await models.Company.findByPk(company.id)).msConsentAt).not.toBeNull();

  res = await w.admin.agent.put(`${API}/companies/${company.id}/m365`).send({
    tenantId: TENANT.toUpperCase(), syncGroups: [{ id: GROUP, name: 'Portal users' }, { id: SECOND_GROUP, name: 'Others' }, { id: GROUP, name: 'dup' }],
  });
  expect(res.status).toBe(200);
  expect(res.body.m365.syncGroups).toHaveLength(2);

  res = await w.admin.agent.get(`${API}/companies/${company.id}/m365/consent-url`);
  const consent = new URL(res.body.url);
  expect(consent.pathname).toBe(`/${TENANT}/adminconsent`);
  expect(consent.searchParams.get('state')).toBe(`consent-${company.id}`);
  // Microsoft brings the admin back through the portal callback to the company page.
  const back = await w.admin.agent.get(`${API}/portal/auth/microsoft/callback?admin_consent=True&tenant=${TENANT}&state=consent-${company.id}`);
  expect(back.status).toBe(302);
  expect(back.headers.location).toMatch(new RegExp(`/companies/${company.id}\\?m365=approved$`));

  await contact({ email: 'p6@tenant.test', msObjectId: uid(6) });
  res = await w.admin.agent.post(`${API}/companies/${company.id}/m365/sync`);
  expect(res.status).toBe(200);
  expect(res.body.lastSync).toMatchObject({ updated: 1, deactivated: 0, errors: [] });

  const tech = await createUserAndLogin({ username: 'tech-m365', roleName: ROLE.TECHNICIAN });
  expect((await tech.agent.post(`${API}/companies/${company.id}/m365/sync`)).status).toBe(403);
});

it('the nightly run syncs each linked company once after 02:00 in the organization\'s time zone', async () => {
  // The latest 02:00 already past, so the sync's own (real) time is after it.
  let runAt = await tonightsRunAt();
  if (runAt > new Date()) runAt = await tonightsRunAt(new Date(runAt.getTime() - 24 * 3600000));
  expect(await runChecks(new Date(runAt.getTime() - 60000))).toEqual([]);
  expect(await runChecks(new Date(runAt.getTime() + 60000))).toEqual([company.id]);
  expect(await runChecks(new Date(Date.now() + 60000))).toEqual([]);
});
