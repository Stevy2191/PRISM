const { resetData, closeDb, models, ROLE, createUserAndLogin } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeProject, setCompanyAccess,
} = require('./fixtures');

const { Company, Contact } = models;

let w;
let acme;
let acmeTicket;
let homeTicket;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  acme = await Company.create({ name: 'Acme', isClient: true });
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  acmeTicket = await makeTicket(w.admin.agent, { title: 'Acme printer', contactId: ann.id });
  homeTicket = await makeTicket(w.admin.agent, { title: 'Home printer', contactId: w.contact.id, departmentId: w.deptA.id });
  tech = await makeTech('tech', w.deptA.id);
});
afterAll(closeDb);

const internalId = async () => (await Company.findOne({ where: { isInternal: true } })).id;
const fence = (userId, companyIds) => setCompanyAccess(w.admin, userId, { allCompanies: false, companyIds });
const forbidden = (thing) => ({ error: true, message: `You do not have access to this ${thing}`, code: 'FORBIDDEN' });
const techRoleId = async () => (await models.Role.findOne({ where: { name: 'System Technician' } })).id;

it('a new user reaches every company', async () => {
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}`)).status).toBe(200);
  expect((await tech.agent.get(`${API}/tickets/${homeTicket.id}`)).status).toBe(200);
});

it('a fenced user is refused another company\'s records', async () => {
  await fence(tech.user.id, [await internalId()]);
  const res = await tech.agent.get(`${API}/tickets/${acmeTicket.id}`);
  expect(res.status).toBe(403);
  expect(res.body).toEqual(forbidden('ticket'));
  expect((await tech.agent.get(`${API}/tickets/${homeTicket.id}`)).status).toBe(200);
});

it('the fence covers projects and contacts too', async () => {
  await fence(tech.user.id, [await internalId()]);
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  // Task 8 adds companyId to the project API; until then, set it directly.
  await models.Project.update({ companyId: acme.id }, { where: { id: p.id } });
  const ann = await Contact.findOne({ where: { companyId: acme.id } });
  const proj = await tech.agent.get(`${API}/projects/${p.id}`);
  expect(proj.status).toBe(403);
  expect(proj.body).toEqual(forbidden('project'));
  const contact = await tech.agent.get(`${API}/contacts/${ann.id}`);
  expect(contact.status).toBe(403);
  expect(contact.body).toEqual(forbidden('contact'));
});

it('link fields treat a fenced-out record like a missing one', async () => {
  await fence(tech.user.id, [await internalId()]);
  const url = `${API}/tickets/${homeTicket.id}/relations`;
  const fenced = await tech.agent.post(url).send({ relatedTicketId: acmeTicket.id });
  const missing = await tech.agent.post(url).send({ relatedTicketId: 99999 });
  expect(fenced.status).toBe(404);
  expect(fenced.body).toEqual(missing.body);
  expect(missing.body.message).toBe('Related ticket not found');
});

it('role grants add to user grants', async () => {
  await fence(tech.user.id, [await internalId()]);
  expectOk(await w.admin.agent.put(`${API}/roles/${await techRoleId()}/company-access`).send({ companyIds: [acme.id] }));
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}`)).status).toBe(200);
});

it('removing a role grant takes effect at once', async () => {
  await fence(tech.user.id, [await internalId()]);
  const roleUrl = `${API}/roles/${await techRoleId()}/company-access`;
  expectOk(await w.admin.agent.put(roleUrl).send({ companyIds: [acme.id] }));
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}`)).status).toBe(200);
  expectOk(await w.admin.agent.put(roleUrl).send({ companyIds: [] }));
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}`)).status).toBe(403);
});

it('removing a user grant takes effect at once', async () => {
  await fence(tech.user.id, [await internalId(), acme.id]);
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}`)).status).toBe(200);
  await fence(tech.user.id, [await internalId()]);
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}`)).status).toBe(403);
});

it('System Administrators can\'t be fenced', async () => {
  const granular = await createUserAndLogin({ username: 'granular', roleName: ROLE.ADMIN, legacyRole: 'technician' });
  for (const userId of [w.admin.user.id, granular.user.id]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.admin.agent.put(`${API}/users/${userId}/company-access`).send({ allCompanies: false, companyIds: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'System Administrators always reach every company', code: 'VALIDATION_ERROR' });
  }
});

it('changing access needs companies.manage_access', async () => {
  const res = await tech.agent.put(`${API}/users/${tech.user.id}/company-access`).send({ allCompanies: true });
  expect(res.status).toBe(403);
});

it('a granter can\'t hand out companies they can\'t reach', async () => {
  const granter = await makeTech('granter', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${granter.user.id}/overrides`)
    .send({ permissionKey: 'companies.manage_access', granted: true }), 201);
  await fence(granter.user.id, [await internalId()]);
  const res = await granter.agent.put(`${API}/users/${tech.user.id}/company-access`)
    .send({ allCompanies: false, companyIds: [acme.id] });
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ error: true, message: 'You can only grant companies you can reach', code: 'FORBIDDEN' });
});

it('access changes are on the permission audit log', async () => {
  await fence(tech.user.id, [await internalId(), acme.id]);
  await fence(tech.user.id, [await internalId()]);
  const { logs } = expectOk(await w.admin.agent.get(`${API}/audit-log?targetUserId=${tech.user.id}`));
  const actions = logs.map((l) => [l.action, l.detail]);
  expect(actions).toContainEqual(['company_access_revoked', { companyIds: [acme.id] }]);
  expect(actions.map((a) => a[0])).toContain('company_access_granted');
});

it('validates the access body', async () => {
  const url = `${API}/users/${tech.user.id}/company-access`;
  const cases = [
    [{ allCompanies: 'yes' }, 'allCompanies must be true or false'],
    [{ allCompanies: false, companyIds: [99999] }, 'Unknown company'],
    [{ allCompanies: false, companyIds: ['1e1'] }, 'Unknown company'],
  ];
  for (const [body, message] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.admin.agent.put(url).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
  }
});

it('GET shows the current access', async () => {
  const id = await internalId();
  await fence(tech.user.id, [id]);
  const { access } = expectOk(await w.admin.agent.get(`${API}/users/${tech.user.id}/company-access`));
  expect(access).toEqual({
    allCompanies: false, companyIds: [id], companies: [expect.objectContaining({ id })], unfenceable: false,
  });
});

it('a fenced user\'s ticket PDF is fenced too', async () => {
  await fence(tech.user.id, [await internalId()]);
  expect((await tech.agent.get(`${API}/tickets/${acmeTicket.id}/report`)).status).toBe(403);
});
