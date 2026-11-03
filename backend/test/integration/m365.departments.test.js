const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { startMockMicrosoft } = require('./mockMicrosoft');
const {
  TENANT, GROUP, uid, person, microsoftSignIn,
} = require('./m365Fixtures');
const { encryptToken } = require('../../src/utils/tokenCrypto');
const { syncCompany } = require('../../src/services/microsoft365/sync');
const { normalizeDepartmentName, suggestMapping } = require('../../src/services/microsoft365/departments');

// Sub-project 7b, task 6: Microsoft 365 department names to create or map.

const API = '/api/v1';
let ms;
let w;
let company;
let accounts;
const member = (n, department) => ({
  id: uid(n), displayName: `Person ${n}`, givenName: 'Person', surname: String(n), mail: `person${n}@tenant.test`, accountEnabled: true, department,
});
const linked = (n, extra = {}) => models.Contact.create({
  firstName: 'P', displayName: `P${n}`, email: `person${n}@tenant.test`, companyId: company.id, msObjectId: uid(n), ...extra,
});
const detected = async () => (await w.admin.agent.get(`${API}/companies/${company.id}/m365/detected-departments`)).body;

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
  accounts = await models.Department.create({ companyId: company.id, name: 'Accounts' });
  ms.failures = [];
  // Three people say "Billing Dept" or " billing  dept", one "billing", one
  // "Accounts" (a department already), one nothing.
  ms.tenants = {
    [TENANT]: {
      users: {
        [uid(1)]: member(1, 'Billing Dept'),
        [uid(2)]: member(2, ' billing  dept'),
        [uid(3)]: member(3, 'Billing Dept'),
        [uid(4)]: member(4, 'billing'),
        [uid(5)]: member(5, 'ACCOUNTS'),
        [uid(6)]: member(6, null),
      },
      groups: { [GROUP]: { name: 'Portal users', members: [1, 2, 3, 4, 5, 6].map(uid) } },
    },
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

it('normalizes names and suggests a department once "dept" is set aside', () => {
  expect(normalizeDepartmentName('  Billing   Dept ')).toBe('billing dept');
  expect(suggestMapping({ name: 'Billing Dept.' }, [{ id: 7, name: 'Billing' }, { id: 8, name: 'Bill' }])).toBe(7);
  expect(suggestMapping({ name: 'Accounts Department' }, [{ id: 9, name: 'accounts' }])).toBe(9);
  expect(suggestMapping({ name: 'Dept' }, [{ id: 9, name: 'department' }])).toBeNull();
});

it('lists every member\'s unmatched department name with a people count, and matched names get their department', async () => {
  const p5 = await linked(5);
  const result = await syncCompany(company.id);
  expect(result.newDetected).toBe(2);
  const { detected: list, mapped } = await detected();
  expect(list.map((d) => [d.name, d.peopleCount])).toEqual([['Billing Dept', 3], ['billing', 1]]);
  expect(mapped).toEqual([]);
  expect((await models.Contact.findByPk(p5.id)).departmentId).toBe(accounts.id);
  // A second sync finds nothing new.
  expect((await syncCompany(company.id)).newDetected).toBe(0);
});

it('creating a department from a name assigns its people at once; mapping another name to it does the same', async () => {
  const people = await Promise.all([1, 2, 3, 4].map((n) => linked(n)));
  await syncCompany(company.id);
  let { detected: list } = await detected();
  const billing = list.find((d) => d.name === 'billing');
  let res = await w.admin.agent.post(`${API}/companies/${company.id}/m365/detected-departments/${billing.id}/create`).send({});
  expect(res.status).toBe(201);
  const created = await models.Department.findByPk(res.body.department.id);
  expect(created).toMatchObject({ companyId: company.id, name: 'billing' });
  expect((await models.Contact.findByPk(people[3].id)).departmentId).toBe(created.id);

  ({ detected: list } = await detected());
  const dept = list.find((d) => d.name === 'Billing Dept');
  expect(dept.suggestedDepartmentId).toBe(created.id);
  res = await w.admin.agent.post(`${API}/companies/${company.id}/m365/detected-departments/${dept.id}/map`).send({ departmentId: created.id });
  expect(res.status).toBe(200);
  expect(res.body.assigned).toBe(3);
  for (const p of people.slice(0, 3)) expect((await models.Contact.findByPk(p.id)).departmentId).toBe(created.id); // eslint-disable-line no-await-in-loop
  // Off the to-do list, and the mapping holds on the next sync.
  expect((await detected()).detected).toEqual([]);
  await syncCompany(company.id);
  expect((await detected()).detected).toEqual([]);
});

it('Microsoft 365 replaces a hand-set department once the name resolves, and the old department\'s admin role goes', async () => {
  const other = await models.Department.create({ companyId: company.id, name: 'Reception' });
  const p4 = await linked(4, { departmentId: other.id });
  await models.DepartmentPortalAdmin.create({ departmentId: other.id, contactId: p4.id });
  await syncCompany(company.id);
  // "billing" doesn't resolve yet: the hand-set department stays.
  expect((await models.Contact.findByPk(p4.id)).departmentId).toBe(other.id);
  const billing = (await detected()).detected.find((d) => d.name === 'billing');
  await w.admin.agent.post(`${API}/companies/${company.id}/m365/detected-departments/${billing.id}/map`).send({ departmentId: accounts.id });
  expect((await models.Contact.findByPk(p4.id)).departmentId).toBe(accounts.id);
  expect(await models.DepartmentPortalAdmin.count({ where: { contactId: p4.id } })).toBe(0);
});

it('refuses a department of another company and a detected row of another company', async () => {
  await syncCompany(company.id);
  const row = (await detected()).detected[0];
  const elsewhere = await makeCompany(w.admin, { name: 'Elsewhere' });
  const theirs = await models.Department.create({ companyId: elsewhere.id, name: 'Theirs' });
  let res = await w.admin.agent.post(`${API}/companies/${company.id}/m365/detected-departments/${row.id}/map`).send({ departmentId: theirs.id });
  expect(res.status).toBe(400);
  res = await w.admin.agent.post(`${API}/companies/${elsewhere.id}/m365/detected-departments/${row.id}/map`).send({ departmentId: theirs.id });
  expect(res.status).toBe(404);
});

it('a new contact from Microsoft sign-in gets the department their name resolves to', async () => {
  const { res } = await microsoftSignIn(ms, request.agent(getApp()), person(5));
  expect(res.status).toBe(302);
  const contact = await models.Contact.findOne({ where: { msObjectId: uid(5) } });
  expect(contact).toMatchObject({ departmentId: accounts.id, msDepartmentName: 'ACCOUNTS' });
  // An unknown name: no department, and it joins the to-do list.
  await microsoftSignIn(ms, request.agent(getApp()), person(4));
  expect((await models.Contact.findOne({ where: { msObjectId: uid(4) } })).departmentId).toBeNull();
  expect((await detected()).detected.map((d) => d.name)).toEqual(['billing']);
});
