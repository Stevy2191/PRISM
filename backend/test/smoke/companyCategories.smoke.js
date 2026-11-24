const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 9, task 5: a company's Categories and Software tabs: build a
// tree, copy one, "asks which app", and the software list (by hand and from
// what the agent found on the company's computers).

const shown = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();

let smoke;
let w;
let page;
let alpha;
let beta;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  beta = await makeCompany(w.admin, { name: 'Beta Law' });
  page = await smoke.pageAs('admin');
  page.on('dialog', (d) => d.accept());
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('builds a tree on a company, marks a category as asking which app, and copies it to another', async () => {
  await page.goto(`/companies/${alpha.id}?tab=setup&part=categories`);
  await page.getByRole('button', { name: 'Add the first category' }).click();
  await page.getByLabel('New category name').fill('Software');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('category-tree').getByText('Software', { exact: true }).waitFor();
  const sw = await models.TicketCategory.findOne({ where: { name: 'Software', companyId: alpha.id } });
  const row = page.getByTestId(`category-${sw.id}`);
  await row.getByRole('button', { name: 'More for Software' }).click();
  await row.getByLabel('asks which app').click();
  await row.getByText('asks which app', { exact: true }).first().waitFor();
  await row.getByLabel('asks which app').and(page.locator(':checked')).waitFor();
  expect((await sw.reload()).pickKind).toBe('software');

  // Beta has none: copy Alpha's.
  await page.goto(`/companies/${beta.id}?tab=setup&part=categories`);
  await page.getByLabel('Copy categories from another company').selectOption({ label: 'Alpha Dental' });
  await page.getByTestId('category-tree').getByText('Software', { exact: true }).waitFor();
  const copy = await models.TicketCategory.findOne({ where: { name: 'Software', companyId: beta.id } });
  expect(copy.id).not.toBe(sw.id);
  expect(copy.pickKind).toBe('software');
  // Settings (the help desk's own tree) never shows a client's.
  await page.goto('/settings/your-company?part=categories');
  await page.getByRole('button', { name: 'Add the first category' }).waitFor();
});

it('adds apps by hand and from the company\'s computers, and turns one off', async () => {
  const computers = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  const pc = await models.Asset.create({ assetTag: 'SM-1', name: 'Front desk', categoryId: computers.id, companyId: alpha.id });
  await models.AssetSoftware.bulkCreate([
    { assetId: pc.id, name: 'Dentrix', version: '7.2', publisher: 'Henry Schein' },
    { assetId: pc.id, name: 'Zoom Workplace', version: '6.2' },
  ]);

  await page.goto(`/companies/${alpha.id}?tab=setup&part=software`);
  await page.getByLabel('New app name').fill('Adobe Acrobat');
  await page.getByRole('button', { name: 'Add app' }).click();
  await shown(page, 'Adobe Acrobat').waitFor();

  await page.getByRole('button', { name: 'From their computers' }).click();
  const found = page.getByRole('region', { name: "Software found on Alpha Dental's computers" });
  await found.getByText('Dentrix', { exact: true }).waitFor();
  await found.getByRole('checkbox').first().check();
  await found.getByRole('button', { name: /Add 1 app/ }).click();
  await page.getByTestId('software-list').getByText('Dentrix', { exact: true }).waitFor();

  const list = expectOk(await w.admin.agent.get(`${API}/companies/${alpha.id}/catalog`).query({ kind: 'software' })).items;
  expect(list.map((i) => i.name).sort()).toEqual(['Adobe Acrobat', 'Dentrix']);
  expect(list.find((i) => i.name === 'Dentrix').publisher).toBe('Henry Schein');

  const acrobat = page.getByTestId('software-list').getByRole('row').filter({ hasText: 'Adobe Acrobat' });
  await acrobat.getByRole('button', { name: 'Turn off' }).click();
  await acrobat.getByText('Off', { exact: true }).waitFor();
  // Beta's list is its own.
  expect(expectOk(await w.admin.agent.get(`${API}/companies/${beta.id}/catalog`).query({ kind: 'software' })).items).toEqual([]);
});
