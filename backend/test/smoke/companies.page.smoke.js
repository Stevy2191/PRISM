const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { openCompanyTab } = require('./companyTabs');

// Plan 2b task 11: the company page.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('shows the company, and adds a domain and a site', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Contact.create({ firstName: 'Ann', displayName: 'Ann Able', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${acme.id}`);
  await page.getByRole('heading', { name: 'Acme' }).waitFor();

  // Overview: the setup checklist says what's missing and opens its place.
  const setup = page.getByTestId('company-setup');
  await setup.getByText('Set up this company · 1 of 12 done').waitFor();
  for (const step of ['SLA targets', 'Support hours and holidays', 'Portal', 'Satisfaction surveys', 'Software list', 'Sites', 'Departments']) await setup.getByText(step, { exact: true }).waitFor(); // eslint-disable-line no-await-in-loop
  await setup.getByRole('listitem').filter({ hasText: 'Email domain' }).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('New domain').fill('acme.test');
  await page.getByRole('button', { name: 'Add domain' }).click();
  await page.getByText('acme.test').waitFor();

  await openCompanyTab(page, 'People', 'Sites');
  await page.getByLabel('Site name').fill('HQ');
  await page.getByRole('button', { name: 'Add site' }).click();
  await page.getByRole('cell', { name: 'HQ' }).waitFor();

  // Just made (from the Companies list): a note says where things are.
  await page.goto(`/companies/${acme.id}?created=1`);
  await page.getByRole('status').getByText('Acme is created. It starts with a copy of your starting SLA targets').waitFor();

  await openCompanyTab(page, 'People', 'Contacts');
  await page.getByRole('link', { name: 'Ann Able' }).waitFor();
});

it('a vendor company has a Vendor tab listing what was bought from it', async () => {
  const admin = await makeAdmin();
  const dell = await models.Company.create({ name: 'Dell', isVendor: true });
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  const category = await models.AssetCategory.create({ name: 'Laptops' });
  await models.Asset.create({ assetTag: 'DELL-9', name: 'Latitude', categoryId: category.id, vendorCompanyId: dell.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${dell.id}`);
  await openCompanyTab(page, 'Assets', 'Vendor');
  await page.getByText('DELL-9').waitFor();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
});

it('company status shows as a chip in the list, and a company page has a breadcrumb', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  const page = await smoke.pageAs('admin');
  await page.goto('/companies');
  const status = page.getByRole('row').filter({ hasText: 'Acme' }).getByText('Active', { exact: true });
  await status.waitFor();
  expect(await status.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

  await page.goto(`/companies/${acme.id}`);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Companies' }).click();
  await page.waitForURL(/\/companies$/);
});

it('a phone number is shown and typed as (XXX) XXX-XXXX, and stored as 10 digits', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme', phone: '9792776200' });
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${acme.id}`);
  await page.getByTestId('company-setup').getByText('(979) 277-6200').waitFor();
  await openCompanyTab(page, 'Setup', 'Details');
  const phone = page.getByLabel('Phone');
  expect(await phone.inputValue()).toBe('(979) 277-6200');
  await phone.fill('');
  await phone.pressSequentially('9795550100');
  expect(await phone.inputValue()).toBe('(979) 555-0100');
  const saved = page.waitForResponse((r) => r.url().endsWith(`/companies/${acme.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  expect((await saved).status()).toBe(200);
  expect((await models.Company.findByPk(acme.id)).phone).toBe('9795550100');
});
