const { closeDb, models } = require('./helpers');
const { startMockMicrosoft } = require('./mockMicrosoft');
const { encryptToken } = require('../../src/utils/tokenCrypto');

// Sub-project 7b, task 2: the read-only Microsoft Graph client, against a
// fake Microsoft (mockMicrosoft.js).

const TENANT = '11111111-2222-3333-4444-555555555555';
const OTHER_TENANT = '99999999-2222-3333-4444-555555555555';
const GROUP = 'a0000000-0000-0000-0000-000000000001';
const NESTED = 'a0000000-0000-0000-0000-000000000002';
const OTHER_GROUP = 'a0000000-0000-0000-0000-000000000003';
const uid = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const user = (n, extra = {}) => ({
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
let graph;

async function saveApp(clientId, clientSecret) {
  await models.SystemSettings.upsert({ key: 'portal.msClientId', value: clientId });
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: encryptToken(clientSecret) });
}

beforeAll(async () => {
  ms = await startMockMicrosoft();
  process.env.MS_LOGIN_BASE = ms.loginBase;
  process.env.MS_GRAPH_BASE = ms.graphBase;
  graph = require('../../src/services/microsoft365/graph'); // eslint-disable-line global-require
});

beforeEach(async () => {
  await saveApp(ms.clientId, ms.clientSecret);
  graph.clearTokenCache();
  ms.tokenRequests = 0;
  ms.failures = [];
  ms.requests = [];
  ms.tenants = {
    [TENANT]: {
      // Five members, one of them through a nested group: three pages of two.
      users: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [uid(n), user(n)])),
      groups: {
        [GROUP]: { name: 'Portal users', members: [uid(1), uid(2), uid(3), uid(4), NESTED] },
        [NESTED]: { name: 'Contractors', members: [uid(5), uid(1)] },
        [OTHER_GROUP]: { name: 'Finance', members: [uid(6)] },
      },
    },
    [OTHER_TENANT]: { users: {}, groups: {} },
  };
});

afterAll(async () => {
  delete process.env.MS_LOGIN_BASE;
  delete process.env.MS_GRAPH_BASE;
  await models.SystemSettings.destroy({ where: { key: ['portal.msClientId', 'portal.msClientSecret'] } });
  await ms.close();
  await closeDb();
});

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

it('caches the app token per tenant until five minutes before it expires', async () => {
  const first = await graph.appToken(TENANT);
  expect(await graph.appToken(TENANT)).toBe(first);
  expect(ms.tokenRequests).toBe(1);
  await graph.appToken(OTHER_TENANT);
  expect(ms.tokenRequests).toBe(2);
  // A token with under five minutes left is never reused.
  graph.clearTokenCache();
  ms.expiresIn = 240;
  try {
    await graph.appToken(TENANT);
    await graph.appToken(TENANT);
    expect(ms.tokenRequests).toBe(4);
  } finally {
    ms.expiresIn = 3600;
  }
});

it('reads every member of a group across pages, nested groups included, users only and once each', async () => {
  const members = await collect(graph.listGroupMembers(TENANT, GROUP));
  expect(members.map((m) => m.id).sort()).toEqual([1, 2, 3, 4, 5].map(uid));
  expect(ms.requests.filter((r) => r.includes('/transitiveMembers/'))).toHaveLength(3);
  expect(members[0]).toEqual(user(1));
});

it('gets one user, or null once they are gone', async () => {
  expect(await graph.getUser(TENANT, uid(2))).toEqual(user(2));
  expect(await graph.getUser(TENANT, uid(99))).toBeNull();
});

it('says whether a person is in any of the given groups, nested membership counting', async () => {
  expect(await graph.memberOfAny(TENANT, uid(5), [OTHER_GROUP, GROUP])).toBe(true);
  expect(await graph.memberOfAny(TENANT, uid(6), [GROUP])).toBe(false);
  expect(await graph.memberOfAny(TENANT, uid(1), [])).toBe(false);
  // More groups than one Graph call takes (20) still works.
  const many = Array.from({ length: 25 }, (_, i) => `c0000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  expect(await graph.memberOfAny(TENANT, uid(6), [...many, OTHER_GROUP])).toBe(true);
});

it('searches groups by name for the sync-group picker', async () => {
  expect(await graph.searchGroups(TENANT, 'portal')).toEqual([{ id: GROUP, name: 'Portal users' }]);
  expect((await graph.searchGroups(TENANT, '')).map((g) => g.name).sort()).toEqual(['Contractors', 'Finance', 'Portal users']);
});

it('retries throttling (429, 503) honouring Retry-After, then gives up after three retries', async () => {
  ms.failures = [
    { match: /\/users\//, status: 429, retryAfter: 0 },
    { match: /\/users\//, status: 503, retryAfter: 0 },
  ];
  expect(await graph.getUser(TENANT, uid(1))).toEqual(user(1));
  ms.failures = Array.from({ length: 4 }, () => ({ match: /\/users\//, status: 429, retryAfter: 0 }));
  await expect(graph.getUser(TENANT, uid(1))).rejects.toMatchObject({ name: 'GraphError', status: 429 });
});

it('throws GraphError on refused access (consent withdrawn) without retrying', async () => {
  ms.failures = [{ match: /transitiveMembers/, status: 403, code: 'Authorization_RequestDenied' }];
  await expect(collect(graph.listGroupMembers(TENANT, GROUP)))
    .rejects.toMatchObject({ name: 'GraphError', status: 403, code: 'Authorization_RequestDenied' });
  expect(ms.requests.filter((r) => r.includes('/transitiveMembers/'))).toHaveLength(1);
});

it('never puts the app secret or a token in an error', async () => {
  await saveApp(ms.clientId, 'wrong-secret-value');
  const err = await graph.appToken(TENANT).catch((e) => e);
  expect(err).toMatchObject({ name: 'GraphError', status: 401, code: 'invalid_client' });
  expect(`${err.message} ${err.stack} ${JSON.stringify(err)}`).not.toMatch(/wrong-secret-value|ms-test-secret/);

  await saveApp(ms.clientId, ms.clientSecret);
  const token = await graph.appToken(TENANT);
  ms.failures = [{ match: /\/users\//, status: 403 }];
  const err2 = await graph.getUser(TENANT, uid(1)).catch((e) => e);
  expect(`${err2.message} ${err2.stack} ${JSON.stringify(err2)}`).not.toContain(token);
});

it('refuses to run without the app, or with ids that are not GUIDs', async () => {
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: '' });
  await expect(graph.appToken(TENANT)).rejects.toMatchObject({ name: 'GraphError', code: 'APP_NOT_CONFIGURED' });
  await saveApp(ms.clientId, ms.clientSecret);
  await expect(graph.appToken('../evil')).rejects.toMatchObject({ name: 'GraphError', code: 'BAD_ID' });
  await expect(graph.getUser(TENANT, 'x/../../groups')).rejects.toMatchObject({ code: 'BAD_ID' });
  expect(ms.requests).toHaveLength(0);
});
