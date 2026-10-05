const { resetData, closeDb } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 9 (Review Focus 1): company UI stays hidden until a client
// company exists; Settings → Companies is always there.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a one-company install shows only Settings → Companies', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/settings');
  await page.getByRole('link', { name: /Companies/ }).first().waitFor();
  await page.goto('/tickets');
  await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
  expect(await page.getByRole('link', { name: 'Companies', exact: true }).count()).toBe(0);
  expect(await page.getByLabel('Company').count()).toBe(0);
});

it('once a client exists, the Companies tab and company filters appear', async () => {
  const admin = await makeAdmin();
  await makeCompany(admin, { name: 'Acme' });
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await page.getByRole('link', { name: 'Companies', exact: true }).first().waitFor();
  await page.goto('/companies');
  await page.getByRole('heading', { name: 'Companies' }).waitFor();
});
