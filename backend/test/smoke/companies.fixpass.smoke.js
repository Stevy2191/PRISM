const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeAdmin, makeCompany, makeTech, makeDept,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b final-review findings F3 and F9.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await smoke.stop();
  await closeDb();
});
beforeEach(resetData);

it('F3: a one-company install doesn\'t map a "Company" CSV column, and imports the rows', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'outlook.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('First name,Email,Company\nOla,ola@x.test,Contoso Ltd\n'),
  });
  await page.getByRole('button', { name: 'Next: Preview' }).click();
  await page.getByRole('button', { name: /Proceed with import/ }).click();
  for (let t = 0; t < 50 && !(await models.Contact.findOne({ where: { email: 'ola@x.test' } })); t += 1) {
    await new Promise((r) => { setTimeout(r, 100); }); // eslint-disable-line no-await-in-loop
  }
  expect(await models.Contact.findOne({ where: { email: 'ola@x.test' } })).not.toBeNull();
});

it('F9: without companies.view, the asset form still offers departments and no empty company select', async () => {
  const admin = await makeAdmin();
  const dept = await makeDept(admin, 'Service Desk', 'SD');
  await makeCompany(admin, { name: 'Acme' });
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await models.AssetCategory.create({ name: 'Laptops' });
  const tech = await makeTech('noview', dept.id);
  expectOk(await admin.agent.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'companies.view', granted: false }), 201);
  const page = await smoke.pageAs('noview');
  await page.goto('/assets');
  await page.getByRole('button', { name: '+ New asset' }).click();
  const form = page.locator('form').last();
  await form.locator('select').filter({ hasText: 'Service Desk' }).first().waitFor();
  expect(await form.locator('#company-picker').count()).toBe(0);
});
