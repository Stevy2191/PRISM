const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeCompany } = require('./fixtures');

// CS: the Companies list is customers and vendors. Your own company's page
// is in Settings; pickers still get every company.

let w;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);

it('leaves your own company out of the list when asked, and keeps it for pickers', async () => {
  await makeCompany(w.admin, { name: 'Acme' });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const list = expectOk(await w.admin.agent.get(`${API}/companies`).query({ own: 'exclude' }));
  expect(list.companies.map((c) => c.name)).toEqual(['Acme']);
  expect(list.companies.some((c) => c.id === internal.id)).toBe(false);
  const all = expectOk(await w.admin.agent.get(`${API}/companies`));
  expect(all.companies.some((c) => c.id === internal.id)).toBe(true);
});
