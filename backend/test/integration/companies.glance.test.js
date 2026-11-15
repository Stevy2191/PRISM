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

it("says whether the SLA was reviewed, the portal is on and surveys were chosen (CS)", async () => {
  const a = w.admin.agent;
  const look = async () => expectOk(await a.get(`${API}/companies/${alpha.id}/glance`)).glance;
  let g = await look();
  expect(g.sla).toEqual({ reviewed: false, hours: 'Around the clock', timezone: 'UTC', holidays: 0 });
  expect(g.portal).toEqual({ enabled: false, slug: alpha.portalSlug });
  expect(g.surveys).toEqual({ enabled: true, chosen: false });
  const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((d, i) => [d, { enabled: i < 5, start: '08:00', end: '17:00' }]));
  expectOk(await a.put(`${API}/companies/${alpha.id}/sla`).send({ is24x7: false, schedule: week, timezone: 'America/Chicago' }));
  expectOk(await a.post(`${API}/companies/${alpha.id}/sla/holidays`).send({ name: 'Day', date: '2026-12-24' }), 201);
  expectOk(await a.put(`${API}/companies/${alpha.id}/portal`).send({ enabled: true }));
  expectOk(await a.put(`${API}/companies/${alpha.id}/surveys`).send({ enabled: true }));
  expectOk(await a.put(`${API}/companies/${alpha.id}/surveys`).send({ enabled: false }));
  g = await look();
  expect(g.sla).toEqual({
    reviewed: true, hours: 'Mon 08:00–17:00, Tue 08:00–17:00, Wed 08:00–17:00, Thu 08:00–17:00, Fri 08:00–17:00', timezone: 'America/Chicago', holidays: 1,
  });
  expect([g.portal.enabled, g.surveys]).toEqual([true, { enabled: false, chosen: true }]);
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

it('the summary names your own company', async () => {
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  expect(expectOk(await w.admin.agent.get(`${API}/companies/summary`)).internalId).toBe(internal.id);
});
