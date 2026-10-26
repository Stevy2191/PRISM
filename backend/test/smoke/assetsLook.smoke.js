const { resetData, closeDb } = require('../integration/helpers');
const { API, expectOk, makeWorld } = require('../integration/fixtures');
const models = require('../../src/models');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: Assets in look A. On a phone the filters sit behind a
// Filters button; desktop keeps them inline.

const PHONE = { viewport: { width: 375, height: 812 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const FILTERS = ['Category', 'Department', 'Status', 'Assigned to'];
const CAT = 'Look A laptops';

let smoke;
let w;
let laptop;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await models.AssetCategory.destroy({ where: { name: CAT } });
  w = await makeWorld();
  const category = await models.AssetCategory.create({ name: CAT });
  const add = async (body) => expectOk(await w.admin.agent.post(`${API}/assets`).send({ categoryId: category.id, ...body }), 201).asset;
  laptop = await add({ name: "Maria's laptop", assetTag: 'LT-0014' });
  await add({ name: 'File server FS01', assetTag: 'SV-0003', status: 'in_repair' });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: CAT } });
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

const rowCount = (page) => page.getByText(/^(LT-0014|SV-0003)$/).filter({ visible: true }).count();

it('on a phone the asset filters are behind Filters', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto('/assets');
  await page.getByText('SV-0003').filter({ visible: true }).first().waitFor();
  for (const name of FILTERS) {
    // eslint-disable-next-line no-await-in-loop
    expect(await page.getByRole('combobox', { name, exact: true }).filter({ visible: true }).count()).toBe(0);
  }
  expect(await rowCount(page)).toBe(2);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  for (const name of FILTERS) {
    // eslint-disable-next-line no-await-in-loop
    await sheet.getByRole('combobox', { name, exact: true }).waitFor();
  }
  const loaded = page.waitForResponse((r) => r.url().includes('/api/v1/assets?') && r.url().includes('status=in_repair'));
  await sheet.getByRole('combobox', { name: 'Status', exact: true }).selectOption('in_repair');
  await loaded;
  await sheet.getByRole('button', { name: 'Done' }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.getByText('LT-0014').filter({ visible: true }).waitFor({ state: 'hidden' });
  expect(await rowCount(page)).toBe(1);
});

it('desktop keeps the filters inline', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/assets');
  for (const name of FILTERS) {
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('combobox', { name, exact: true }).filter({ visible: true }).first().waitFor();
  }
  expect(await page.getByRole('button', { name: /^Filters/ }).filter({ visible: true }).count()).toBe(0);
});

it('an asset page has a breadcrumb back to Assets', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/assets/${laptop.id}`);
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await crumbs.getByRole('link', { name: 'Assets' }).click();
  await page.waitForURL(/\/assets$/);
});

it('no matching assets shows the empty state and New asset', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/assets');
  await page.getByRole('textbox', { name: 'Search assets' }).fill('nothing-matches-this');
  await page.getByText('No assets found.').waitFor();
  await page.getByRole('button', { name: /New asset/ }).filter({ visible: true }).first().waitFor();
});
