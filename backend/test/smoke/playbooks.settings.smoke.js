const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Playbooks (PB, task 12): Settings › MDMs, and the asset form's management
// and cellular fields. Checklists and bundles: checklists.settings.smoke.js (PB2).

let smoke;
let w;
let page;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('MDMs: add one, and retire it', async () => {
  await page.goto('/settings/mdms');
  await page.getByLabel('New MDM name').fill('MDM A');
  await page.getByLabel('New MDM console address').fill('https://a.example/devices/{id}');
  await page.getByRole('button', { name: 'Add MDM' }).click();
  await page.getByLabel('MDM A active').waitFor();
  await page.getByLabel('MDM A active').click();
  await page.getByRole('cell').getByText('Retired', { exact: true }).waitFor();
  for (let i = 0; i < 20 && (await models.Mdm.findOne({ where: { name: 'MDM A' } })).isActive; i += 1) await page.waitForTimeout(100); // eslint-disable-line no-await-in-loop
  expect((await models.Mdm.findOne({ where: { name: 'MDM A' } })).isActive).toBe(false);
});

it('the asset form: managed by an MDM, and a phone line', async () => {
  const [mdm] = await models.Mdm.findOrCreate({ where: { name: 'MDM A' }, defaults: { name: 'MDM A' } });
  await mdm.update({ isActive: true });
  const category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  const asset = await models.Asset.create({ assetTag: 'SM-A1', name: 'Field laptop', categoryId: category.id, companyId: (await models.Company.findOne({ where: { isInternal: true } })).id });
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.getByRole('group', { name: 'Managed' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByTestId('mdm-select').selectOption({ label: 'MDM A' });
  await page.getByRole('group', { name: 'Cellular' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByLabel('IMEI').fill('353918114826114');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('353918114826114').waitFor();
  const fresh = await models.Asset.findByPk(asset.id);
  expect(fresh).toMatchObject({ isManaged: true, hasCellular: true, imei: '353918114826114' });
});
