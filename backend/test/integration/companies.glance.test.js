const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, makeContact, makeTicket, setCompanyAccess,
} = require('./fixtures');

// The company Overview's figures and setup checklist.

let w;
let alpha;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
});
afterAll(closeDb);

it('counts what the company has set up', async () => {
  const a = w.admin.agent;
  let { glance } = expectOk(await a.get(`${API}/companies/${alpha.id}/glance`));
  expect(glance).toMatchObject({
    openTickets: 0, pastSla: 0, contacts: 0, portalContacts: 0, departments: [], sites: 0, domains: 0, categories: 0, devices: 0, devicesOnline: 0,
  });
  const amy = await makeContact(w.admin, { companyId: alpha.id, firstName: 'Amy', lastName: 'Ng' });
  await models.Contact.update({ portalAccess: true }, { where: { id: amy.id } });
  await makeContact(w.admin, { companyId: alpha.id, firstName: 'Bo', lastName: 'Li' });
  await makeTicket(a, { title: 'Wifi', contactId: amy.id });
  expectOk(await a.post(`${API}/ticket-categories`).send({ name: 'Network', companyId: alpha.id }), 201);
  expectOk(await a.post(`${API}/companies/${alpha.id}/domains`).send({ domain: 'alphadental.test' }), 201);
  ({ glance } = expectOk(await a.get(`${API}/companies/${alpha.id}/glance`)));
  expect(glance).toMatchObject({ openTickets: 1, contacts: 2, portalContacts: 1, categories: 1, domains: 1 });
});

it('is fenced like the company, and leaves out what the viewer may not see', async () => {
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  const tech = await makeTech('tech-gl', w.deptA.id);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [alpha.id] });
  const other = await tech.agent.get(`${API}/companies/${beta.id}/glance`);
  expect([403, 404]).toContain(other.status);
  const mine = await tech.agent.get(`${API}/companies/${alpha.id}/glance`);
  if (mine.status === 200) expect(mine.body.glance.categories).toBeNull();
  else expect(mine.status).toBe(403);
});
