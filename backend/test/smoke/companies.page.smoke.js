const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

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

  await page.getByLabel('New domain').fill('acme.test');
  await page.getByRole('button', { name: 'Add domain' }).click();
  await page.getByText('acme.test').waitFor();

  await page.getByRole('button', { name: 'Sites' }).click();
  await page.getByLabel('Site name').fill('HQ');
  await page.getByRole('button', { name: 'Add site' }).click();
  await page.getByRole('cell', { name: 'HQ' }).waitFor();

  await page.getByRole('button', { name: 'Contacts' }).click();
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
  await page.getByRole('button', { name: 'Vendor' }).click();
  await page.getByText('DELL-9').waitFor();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
});
