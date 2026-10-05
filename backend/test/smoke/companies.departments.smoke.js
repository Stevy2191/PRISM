const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 18.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('departments are grouped by company, and a client department can be created there', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/admin/departments');
  await page.getByText('Acme', { exact: true }).waitFor();
  await page.getByRole('button', { name: '+ New department' }).click();
  await page.locator('#company-picker').selectOption(String(acme.id));
  await page.locator('input').first().fill('Acme Ops');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText('Acme Ops').waitFor();
  expect((await models.Department.findOne({ where: { name: 'Acme Ops' } })).companyId).toBe(acme.id);
});

it('the import preview flags a Company the file names but PRISM doesn\'t know', async () => {
  const admin = await makeAdmin();
  await makeCompany(admin, { name: 'Acme' });
  const page = await smoke.pageAs('admin');
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('First name,Email,Company\nAnn,ann@x.test,Acme\nNed,ned@x.test,Nope Inc\n'),
  });
  await page.getByRole('button', { name: 'Next: Preview' }).click();
  await page.getByText('"Nope Inc" does not match any company').waitFor();
});

it('editing a client department doesn\'t demand a short code', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/admin/departments');
  const row = page.locator('div.flex.items-center.justify-between').filter({ hasText: 'Acme HR' });
  await row.getByRole('button', { name: 'edit' }).click();
  await page.locator('form input').first().fill('Acme People');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Acme People').waitFor();
});
