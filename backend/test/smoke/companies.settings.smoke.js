const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 10: Settings → Companies.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('lists companies with their counts and creates one', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/companies');
  const row = page.getByRole('row', { name: /Acme/ });
  await row.waitFor();
  expect(await row.textContent()).toMatch(/Client/);
  await page.getByRole('button', { name: '+ New company' }).click();
  await page.getByLabel('Name').fill('Globex');
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.getByRole('row', { name: /Globex/ }).waitFor();
});

it('merges one company into another after a preview', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  const globex = await makeCompany(admin, { name: 'Globex' });
  await models.Contact.create({ firstName: 'Gus', displayName: 'Gus', companyId: globex.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/companies');
  await page.getByRole('row', { name: /Globex/ }).getByRole('button', { name: 'Merge into…' }).click();
  await page.getByLabel('Merge into').selectOption(String(acme.id));
  await page.getByText('Contacts').first().waitFor();
  await page.getByLabel(/can't be undone/).check();
  await page.getByRole('button', { name: 'Merge into Acme' }).click();
  await page.getByRole('row', { name: /Globex/ }).waitFor({ state: 'detached' });
  expect(await models.Contact.count({ where: { companyId: acme.id } })).toBe(1);
});
