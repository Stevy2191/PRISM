const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { openCompanyTab } = require('./companyTabs');

// Plan 2b task 18.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('Settings → Departments is the help desk\'s own; a client department is created on its company page', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/admin/departments');
  await page.getByText('Service Desk', { exact: true }).waitFor();
  expect(await page.getByText('Acme HR').count()).toBe(0);
  await page.goto(`/companies/${acme.id}`);
  await openCompanyTab(page, 'People', 'Departments');
  await page.getByText('Acme HR').waitFor();
  await page.getByLabel('Department name').fill('Acme Ops');
  await page.getByRole('button', { name: 'Add department' }).click();
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

it('renaming a client department doesn\'t demand a short code', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${acme.id}`);
  await openCompanyTab(page, 'People', 'Departments');
  page.once('dialog', (d) => d.accept('Acme People'));
  await page.getByRole('button', { name: 'Rename Acme HR' }).click();
  await page.getByText('Acme People').waitFor();
  expect((await models.Department.findOne({ where: { name: 'Acme People' } })).shortCode).toBeNull();
});
