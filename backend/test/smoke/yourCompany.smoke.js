const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// CS part 1: your company's page is in Settings; Companies lists customers;
// a new company opens on its own page.

let smoke;
let w;
let internal;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  internal = await models.Company.findOne({ where: { isInternal: true } });
  await makeCompany(w.admin, { name: 'Acme Manufacturing' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('Settings › Your company is one page with its parts', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/your-company');
  await page.getByRole('heading', { level: 1, name: internal.name }).waitFor();
  const parts = page.getByRole('navigation', { name: "Your company's settings" });
  for (const name of ['Profile and sign-in page', 'Departments', 'Sites', 'Categories', 'Devices']) {
    await parts.getByRole('button', { name, exact: true }).waitFor(); // eslint-disable-line no-await-in-loop
  }
  await page.getByLabel('Company name').waitFor();
  await parts.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByText(w.deptA.name, { exact: true }).first().waitFor();
});

it('the Companies list shows customers, not your own company', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/companies');
  await page.getByRole('link', { name: 'Acme Manufacturing' }).waitFor();
  expect(await page.getByRole('link', { name: internal.name, exact: true }).count()).toBe(0);
  // Its old address under Companies leads to Settings.
  await page.goto(`/companies/${internal.id}`);
  await page.waitForURL('**/settings/your-company');
});

it('a new company opens on its own page', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/companies');
  await page.getByRole('button', { name: /New company/ }).click();
  await page.getByLabel('Name').fill('Bolt Logistics');
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.waitForURL(/\/companies\/\d+$/);
  await page.getByRole('heading', { level: 1, name: 'Bolt Logistics' }).waitFor();
});

describe('only your own company', () => {
  beforeAll(async () => { await models.Company.update({ isClient: false }, { where: { isInternal: false } }); });
  afterAll(async () => { await models.Company.update({ isClient: true }, { where: { isInternal: false } }); });

  it('Settings › Customers offers "Add a customer company", which opens the form', async () => {
    const page = await smoke.pageAs('admin');
    await page.goto('/settings?section=customers');
    await page.getByRole('link', { name: /Add a customer company/ }).click();
    await page.waitForURL(/\/companies\?new=1/);
    await page.getByRole('button', { name: 'Create company' }).waitFor();
  });
});
