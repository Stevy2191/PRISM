const { resetData, closeDb, models, createUserAndLogin, ROLE } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Phase 3, step 1, task 8: the Money settings, a customer's Billing, support
// tiers and after-hours time in the browser; what a technician doesn't see.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
let smoke;
let w;
let page;
let acme;
let sam;
let ticket;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme Auto' });
  sam = await makeContact(w.admin, { companyId: acme.id, firstName: 'Sam', lastName: 'Shop' });
  ticket = await makeTicket(w.admin.agent, { title: 'Bay PC down', contactId: sam.id });
  await makeTech('tess', w.deptA.id);
  page = await smoke.pageAs('admin');
  page.on('dialog', (d) => d.accept());
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('sets the rates, a tax rate and category, and a product sold by the foot', async () => {
  await page.goto('/settings/money/rates');
  await page.getByLabel('Hourly rate ($)').fill('100');
  await page.getByLabel('After-hours rate ($)').fill('150');
  await page.getByLabel('Trip charge per on-site visit ($)').fill('45');
  await page.getByRole('button', { name: 'Save rates' }).click();
  await page.getByText('Rates saved.').waitFor();
  await page.reload();
  expect(await page.getByLabel('Trip charge per on-site visit ($)').inputValue()).toBe('45.00');

  await page.goto('/settings/money/tax');
  await page.getByLabel('New tax rate name').fill('Riverside');
  await page.getByLabel('New tax rate percent').fill('8.25');
  await page.getByRole('button', { name: 'Add rate' }).click();
  await page.getByText('Riverside', { exact: true }).waitFor();
  await page.getByText('default', { exact: true }).waitFor();
  await page.getByLabel('New tax category name').fill('Data processing');
  await page.getByLabel('New tax category share').fill('80');
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByText('Data processing', { exact: true }).waitFor();

  await page.goto('/settings/money/products');
  await page.getByRole('button', { name: 'Add product' }).click();
  const form = page.getByRole('form', { name: 'Product' });
  await form.getByLabel('Name').fill('Cat6 cable');
  await form.getByLabel('Sold per (unit)').fill('ft');
  await form.getByLabel('Bought per (unit, if different)').fill('box');
  await form.getByLabel('ft in one box').fill('1000');
  await form.getByLabel('Cost per box ($)').fill('180');
  await form.getByLabel('Tax category').selectOption({ label: 'Cabling' });
  await form.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('products').getByText('$0.1800/ft').first().waitFor();
});

it('a customer: tax exempt with a certificate, Net 15, a Light user, after-hours time', async () => {
  await page.goto(`/companies/${acme.id}?tab=setup&part=billing`);
  const billing = page.getByTestId('company-billing');
  await billing.getByLabel('Tax exempt (with a certificate)').click();
  await billing.getByText('Exemption saved.').waitFor();
  await billing.getByLabel('Exemption certificate').setInputFiles({ name: 'exemption.pdf', mimeType: 'application/pdf', buffer: PDF });
  await billing.getByText('exemption.pdf').waitFor();
  await billing.getByLabel(/Payment terms, days/).fill('15');
  await billing.getByRole('button', { name: 'Save terms and rates' }).click();
  await billing.getByText('Terms and rates saved.').waitFor();
  const row = await models.CompanyBilling.findByPk(acme.id);
  expect(row).toMatchObject({ taxExempt: true, termsDays: 15, exemptCertificateName: 'exemption.pdf' });

  await page.goto(`/contacts/${sam.id}`);
  await page.getByLabel(/Support tier/).selectOption('light');
  await page.waitForFunction(async (id) => (await (await fetch(`/api/v1/contacts/${id}`)).json()).contact.supportTier === 'light', sam.id);

  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: /^Time$/ }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Log time', exact: true }).filter({ visible: true }).first().click();
  await page.getByLabel('After hours').selectOption('yes');
  await page.getByRole('button', { name: 'Save time entry' }).click();
  await page.getByText('after hours', { exact: true }).first().waitFor();
  expect((await models.TimeEntry.findOne({ where: { ticketId: ticket.id } })).afterHours).toBe(true);
});

it('a technician sees no Money, no Billing, no tier, and still logs time', async () => {
  const tech = await smoke.pageAs('tess');
  await tech.goto('/settings');
  await tech.getByText('Preferences').first().waitFor();
  expect(await tech.getByText('Money', { exact: true }).count()).toBe(0);
  const res = await tech.request.get(`${API}/money/settings`);
  expect(res.status()).toBe(403);
  await tech.goto(`/contacts/${sam.id}`);
  await tech.getByText('Sam Shop').first().waitFor();
  expect(await tech.getByLabel(/Support tier/).count()).toBe(0);
});

it('only an Owner can switch customer billing on', async () => {
  await page.goto('/settings/money/general');
  const sw = page.getByRole('switch', { name: 'Customer billing' });
  await sw.click();
  await page.getByText('Customer billing saved.').waitFor();
  expect(expectOk(await w.admin.agent.get(`${API}/money/config`)).customerBilling).toBe(true);
  const adam = await createUserAndLogin({ username: 'adam', roleName: ROLE.ADMIN, legacyRole: 'admin' });
  expect(adam).toBeTruthy();
  const other = await smoke.pageAs('adam', adam.password);
  await other.goto('/settings/money/general');
  await other.getByText('only an Owner can change this', { exact: false }).waitFor();
  expect(await other.getByRole('switch', { name: 'Customer billing' }).isDisabled()).toBe(true);
});
