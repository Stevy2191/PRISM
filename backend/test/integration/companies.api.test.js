const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeContact, setCompanyAccess,
} = require('./fixtures');

// The companies, domains and sites API (client companies, plan 2a task 5).

const { Company, AuditLog } = models;

let w;
let tech;
let internal;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  internal = await Company.findOne({ where: { isInternal: true } });
});
afterAll(closeDb);

const a = () => w.admin.agent;
const create = async (body) => expectOk(await a().post(`${API}/companies`).send(body), 201).company;
const err = (status, code, message) => ({ status, body: { error: true, message, code } });
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual(err(status, code, message));
};

it('creates a client company with defaults', async () => {
  const c = await create({ name: '  Acme Corp  ', isClient: true });
  expect(c).toEqual(expect.objectContaining({
    name: 'Acme Corp', isClient: true, isVendor: false, isInternal: false, status: 'active',
    phone: null, website: null, accountManagerId: null,
  }));
});

it('validates company fields', async () => {
  const cases = [
    [{}, 'Company name is required'],
    [{ name: '   ' }, 'Company name is required'],
    [{ name: 'x'.repeat(151) }, 'Company name must be 150 characters or fewer'],
    [{ name: 'A', website: 'javascript:alert(1)' }, 'Website must be an http(s) address'],
    [{ name: 'A', accountManagerId: 99999 }, 'Unknown account manager'],
    [{ name: 'A', accountManagerId: '1e1' }, 'Unknown account manager'],
  ];
  for (const [body, message] of cases) {
    // eslint-disable-next-line no-await-in-loop
    expectErr(await a().post(`${API}/companies`).send(body), 400, 'VALIDATION_ERROR', message);
  }
});

it('names are unique among active companies, ignoring case', async () => {
  const first = await create({ name: 'Acme', isClient: true });
  expectErr(await a().post(`${API}/companies`).send({ name: 'ACME ' }), 409, 'COMPANY_NAME_TAKEN', 'A company with this name already exists');
  expectOk(await a().patch(`${API}/companies/${first.id}`).send({ status: 'inactive' }));
  expect((await a().post(`${API}/companies`).send({ name: 'acme' })).status).toBe(201);
});

it('isInternal can\'t be set or cleared through the API', async () => {
  expect((await create({ name: 'X', isInternal: true })).isInternal).toBe(false);
  expectOk(await a().patch(`${API}/companies/${internal.id}`).send({ isInternal: false }));
  expect((await internal.reload()).isInternal).toBe(true);
});

it('the internal company can\'t be deactivated or deleted', async () => {
  expectErr(await a().patch(`${API}/companies/${internal.id}`).send({ status: 'inactive' }), 400, 'VALIDATION_ERROR', 'The internal company cannot be deactivated');
  expectErr(await a().delete(`${API}/companies/${internal.id}`), 400, 'VALIDATION_ERROR', 'The internal company cannot be deleted');
});

it('delete works only when nothing uses the company', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  expect(expectOk(await a().delete(`${API}/companies/${acme.id}`))).toEqual({ ok: true });
  const beta = await create({ name: 'Beta', isClient: true });
  await models.Contact.create({ firstName: 'Bo', displayName: 'Bo', companyId: beta.id });
  expectErr(await a().delete(`${API}/companies/${beta.id}`), 409, 'COMPANY_IN_USE', 'This company has records. Deactivate or merge it instead.');
});

it('lists, filters and searches', async () => {
  await create({ name: 'Acme', isClient: true });
  await create({ name: 'Dell', isVendor: true });
  const old = await create({ name: 'Old', isClient: true });
  expectOk(await a().patch(`${API}/companies/${old.id}`).send({ status: 'inactive' }));
  const names = async (q) => expectOk(await a().get(`${API}/companies${q}`)).companies.map((c) => c.name);
  const body = expectOk(await a().get(`${API}/companies`));
  expect(body).toEqual(expect.objectContaining({ page: 1, total: 4, totalPages: 1 }));
  expect(await names('?kind=client')).toEqual([internal.name, 'Acme', 'Old']);
  expect(await names('?kind=vendor')).toEqual(['Dell']);
  expect(await names('?status=inactive')).toEqual(['Old']);
  expect(await names('?search=ac')).toEqual(['Acme']);
});

it('summary counts clients, not vendors', async () => {
  const summary = async () => expectOk(await a().get(`${API}/companies/summary`));
  expect(await summary()).toEqual({ count: 1, multiCompany: false });
  await create({ name: 'Dell', isVendor: true });
  expect(await summary()).toEqual({ count: 2, multiCompany: false });
  await create({ name: 'Acme', isClient: true });
  expect(await summary()).toEqual({ count: 3, multiCompany: true });
});

it('domains: add, normalise, refuse free-mail and duplicates', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  const beta = await create({ name: 'Beta', isClient: true });
  const url = (c) => `${API}/companies/${c.id}/domains`;
  expect(expectOk(await a().post(url(acme)).send({ domain: ' @ACME.com ' }), 201).domain.domain).toBe('acme.com');
  expectErr(await a().post(url(acme)).send({ domain: 'gmail.com' }), 400, 'VALIDATION_ERROR', "Free email domains can't identify a company");
  expectErr(await a().post(url(beta)).send({ domain: 'acme.com' }), 409, 'DOMAIN_TAKEN', 'This domain already belongs to a company');
  expectErr(await a().post(url(acme)).send({ domain: 'not a domain' }), 400, 'VALIDATION_ERROR', 'Invalid domain');
});

it('removes a domain', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  const beta = await create({ name: 'Beta', isClient: true });
  const d1 = expectOk(await a().post(`${API}/companies/${acme.id}/domains`).send({ domain: 'acme.com' }), 201).domain;
  const d2 = expectOk(await a().post(`${API}/companies/${beta.id}/domains`).send({ domain: 'beta.com' }), 201).domain;
  expect(expectOk(await a().delete(`${API}/companies/${acme.id}/domains/${d1.id}`))).toEqual({ ok: true });
  expectErr(await a().delete(`${API}/companies/${acme.id}/domains/${d2.id}`), 404, 'NOT_FOUND', 'Domain not found');
});

it('sites: create, validate, list, update, deactivate', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  const url = `${API}/companies/${acme.id}/sites`;
  const site = expectOk(await a().post(url).send({ name: 'HQ', line1: '1 Main St', city: 'Springfield' }), 201).site;
  expect(site).toEqual(expect.objectContaining({ name: 'HQ', line1: '1 Main St', city: 'Springfield', status: 'active', companyId: acme.id }));
  expectErr(await a().post(url).send({ name: 'hq' }), 409, 'SITE_NAME_TAKEN', 'This company already has a site with that name');
  expectErr(await a().post(url).send({ name: '' }), 400, 'VALIDATION_ERROR', 'Site name is required');
  expect(expectOk(await a().get(url)).sites.map((s) => s.name)).toEqual(['HQ']);
  expect(expectOk(await a().patch(`${url}/${site.id}`).send({ status: 'inactive' })).site.status).toBe('inactive');
});

it('a site is only reachable through its own company', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  const beta = await create({ name: 'Beta', isClient: true });
  const betaSite = expectOk(await a().post(`${API}/companies/${beta.id}/sites`).send({ name: 'Plant' }), 201).site;
  expectErr(await a().patch(`${API}/companies/${acme.id}/sites/${betaSite.id}`).send({ name: 'x' }), 404, 'NOT_FOUND', 'Site not found');
});

it('the API is fenced by company access', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internal.id] });
  expect(expectOk(await tech.agent.get(`${API}/companies`)).companies.map((c) => c.id)).toEqual([internal.id]);
  const forbidden = { error: true, message: 'You do not have access to this company', code: 'FORBIDDEN' };
  for (const res of [
    await tech.agent.get(`${API}/companies/${acme.id}`),
    await tech.agent.get(`${API}/companies/${acme.id}/sites`),
  ]) {
    expect(res.status).toBe(403);
    expect(res.body).toEqual(forbidden);
  }
  const mgr = await makeManager('mgr', w.deptA.id);
  expectOk(await a().post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'companies.manage', granted: true }), 201);
  await setCompanyAccess(w.admin, mgr.user.id, { allCompanies: false, companyIds: [internal.id] });
  const write = await mgr.agent.patch(`${API}/companies/${acme.id}`).send({ phone: '555' });
  expect(write.status).toBe(403);
  expect(write.body).toEqual(forbidden);
});

it('permissions gate reads and writes', async () => {
  expect((await tech.agent.get(`${API}/companies`)).status).toBe(200);
  expect((await tech.agent.post(`${API}/companies`).send({ name: 'Nope' })).status).toBe(403);
});

it('changes are audited', async () => {
  const acme = await create({ name: 'Acme', isClient: true });
  expectOk(await a().patch(`${API}/companies/${acme.id}`).send({ phone: '555-0100' }));
  expectOk(await a().post(`${API}/companies/${acme.id}/domains`).send({ domain: 'acme.com' }), 201);
  const site = expectOk(await a().post(`${API}/companies/${acme.id}/sites`).send({ name: 'HQ' }), 201).site;
  // No endpoint reads AuditLogs.
  const rows = await AuditLog.findAll({ where: { action: ['company.create', 'company.update', 'company.domain_add', 'site.create'] }, raw: true });
  expect(rows.map((r) => [r.action, r.entityId]).sort()).toEqual([
    ['company.create', acme.id], ['company.domain_add', acme.id], ['company.update', acme.id], ['site.create', site.id],
  ].sort());
});

it('GET shows domains and the account manager', async () => {
  const acme = await create({ name: 'Acme', isClient: true, accountManagerId: tech.user.id });
  expectOk(await a().post(`${API}/companies/${acme.id}/domains`).send({ domain: 'acme.com' }), 201);
  const { company } = expectOk(await a().get(`${API}/companies/${acme.id}`));
  expect(company.domains).toEqual([expect.objectContaining({ domain: 'acme.com' })]);
  expect(company.accountManager).toEqual({ id: tech.user.id, displayName: 'Test tech' });
});
