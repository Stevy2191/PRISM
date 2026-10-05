const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeTech, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 17.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('an admin limits a technician to chosen companies', async () => {
  const admin = await makeAdmin();
  const dept = await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  const tech = await makeTech('tina', dept.id);
  const page = await smoke.pageAs('admin');
  await page.goto(`/admin/users/${tech.user.id}`);
  await page.getByRole('button', { name: 'Roles & Permissions' }).click();
  await page.getByLabel('Chosen companies').check();
  await page.getByLabel('Acme').check();
  await page.getByRole('button', { name: 'Save company access' }).click();
  await page.getByText('Company access saved').waitFor();
  const user = await models.User.findByPk(tech.user.id);
  const rows = await models.UserCompanyAccess.findAll({ where: { userId: tech.user.id } });
  expect([user.allCompanies, rows.map((r) => r.companyId)]).toEqual([false, [acme.id]]);
});
