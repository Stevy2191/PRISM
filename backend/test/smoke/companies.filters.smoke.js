const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 16.

// Lists render a desktop table and a CSS-hidden mobile copy: match only
// what's visible.
const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let admin;
let acme;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => {
  await resetData();
  admin = await makeAdmin();
  acme = await makeCompany(admin, { name: 'Acme' });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const ann = await models.Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const bob = await models.Contact.create({ firstName: 'Bob', displayName: 'Bob', companyId: internal.id });
  await makeTicket(admin.agent, { title: 'ACME ticket', contactId: ann.id });
  await makeTicket(admin.agent, { title: 'HOME ticket', contactId: bob.id });
});

it('the ticket list filters by company, and opens pre-filtered from ?companyId=', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await shown(page, 'HOME ticket').waitFor();
  await page.getByLabel('Company').selectOption(String(acme.id));
  await page.getByText('HOME ticket').first().waitFor({ state: 'detached' });
  await shown(page, 'ACME ticket').waitFor();
  await page.goto(`/tickets?companyId=${acme.id}`);
  await shown(page, 'ACME ticket').waitFor();
  expect(await page.getByText('HOME ticket').count()).toBe(0);
});

it('a report filters by company', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/reports');
  // A wide custom range: preset ranges end today, and quirk Q36 makes an
  // endDate stop at the start of that local day — a ticket made seconds ago
  // would fall outside "This month".
  await page.getByRole('button', { name: 'Custom range' }).click();
  const dates = page.locator('input[type=date]');
  await dates.nth(0).fill('2000-01-01');
  await dates.nth(1).fill('2099-12-31');
  await page.getByLabel('Company').selectOption(String(acme.id));
  await shown(page, 'ACME ticket').waitFor();
  expect(await page.getByText('HOME ticket').count()).toBe(0);
});
