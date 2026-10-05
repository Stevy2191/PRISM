const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 15 (Review Focus 2).

let smoke;
let category;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await smoke.stop();
  await closeDb();
});
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  category = await models.AssetCategory.create({ name: 'Laptops' });
});

it('the asset form only offers the chosen company\'s departments and sites, and picks a vendor', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  await models.Site.create({ name: 'Acme HQ', companyId: acme.id });
  await models.Company.create({ name: 'Dell', isVendor: true });

  const page = await smoke.pageAs('admin');
  await page.goto('/assets');
  await page.getByRole('button', { name: '+ New asset' }).click();
  await page.locator('#company-picker').selectOption(String(acme.id));
  // Scoped to the modal's form: the list page behind it has its own department filter.
  const form = page.locator('form').last();
  const deptOptions = await form.locator('select').filter({ hasText: 'Acme HR' }).first().locator('option').allTextContents();
  expect(deptOptions).not.toContain('Service Desk');
  await form.getByLabel('Site').selectOption({ label: 'Acme HQ' });
  await page.getByLabel('Vendor').fill('De');
  await page.getByRole('button', { name: 'Dell' }).click();
  await form.locator('select').filter({ hasText: 'Laptops' }).first().selectOption(String(category.id));
  await page.getByPlaceholder("e.g. Sean's Laptop").fill('Acme laptop');
  await page.getByRole('button', { name: 'Create asset' }).click();
  const poll = async () => models.Asset.findOne({ where: { name: 'Acme laptop' }, include: [{ model: models.Company, as: 'vendorCompany' }] });
  let asset;
  for (let t = 0; t < 50 && !asset; t += 1) {
    asset = await poll(); // eslint-disable-line no-await-in-loop
    if (!asset) await new Promise((r) => { setTimeout(r, 100); }); // eslint-disable-line no-await-in-loop
  }
  expect([asset.companyId, asset.vendorCompany.name]).toEqual([acme.id, 'Dell']);
  expect(asset.siteId).not.toBeNull();
});
