jest.mock('../../src/services/emailSender');
const bcrypt = require('bcryptjs');
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  makeWorld, makeCompany, makeContact, makeTech,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { sendMail } = require('../../src/services/emailSender');
const stripe = require('../../src/services/money/stripe');
const { makeFakeStripe } = require('../integration/fakeStripe');

// Phase 3, step 3, task 8: the customer billing screens. Alpha Dental's
// agreement, the January billing run, sending the draft, paying it from
// the emailed link (no sign-in), a check for part of it, and the portal.

const PASSWORD = 'Harbour-Lights-2026';
let smoke;
let w;
let page;
let alpha;
let dana;
let token;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  for (const [key, value] of [['money.customerBilling', 'true'], ['company.name', 'Northwind IT'], ['money.stripeSecretKey', 'set']]) {
    await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  }
  stripe.setClientForTests(makeFakeStripe());
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  await models.Company.update({ portalEnabled: true }, { where: { id: alpha.id } });
  dana = await makeContact(w.admin, { firstName: 'Dana', lastName: 'Diaz', email: 'dana@alpha.test', companyId: alpha.id });
  await models.CompanyPortalAdmin.create({ companyId: alpha.id, contactId: dana.id });
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: await bcrypt.hash(PASSWORD, 4) }, { where: { id: dana.id } });
  await makeTech('tess', w.deptA.id);
  page = await smoke.pageAs('admin');
  page.on('dialog', (d) => d.accept());
});
afterAll(async () => {
  stripe.setClientForTests(null);
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('an agreement for Alpha, with this month\'s count', async () => {
  await page.goto('/money?tab=agreements');
  await page.getByRole('button', { name: 'New agreement' }).click();
  const form = page.getByRole('form', { name: 'Agreement' });
  await form.getByLabel('Customer', { exact: true }).selectOption({ label: 'Alpha Dental' });
  await form.getByLabel('Starts').fill('2026-12-01');
  const line = form.getByRole('group', { name: 'Line 1' });
  await line.getByLabel('Price').fill('95');
  await form.getByRole('button', { name: 'Save agreement' }).click();
  const preview = page.getByTestId('agreement-preview');
  await preview.getByText('$95.00').first().waitFor();
  await preview.getByText('(support tiers)').waitFor();
});

it('the January run drafts Alpha\'s invoice; sending emails it with the pay link', async () => {
  await page.goto('/money?tab=billing-run');
  await page.getByLabel('Run date').fill('2027-01-01');
  await page.getByRole('button', { name: 'Draft the invoices' }).click();
  await page.getByText(/Drafted 1 invoice: Alpha Dental \$95\.00/).waitFor();

  await page.goto('/money?tab=invoices');
  await page.getByTestId('invoices').getByText('Draft').first().click();
  sendMail.mockClear();
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await page.getByText(/Sent and emailed to dana@alpha\.test/).waitFor();
  const [mail] = sendMail.mock.calls[0];
  [, token] = mail.html.match(/\/pay\/([A-Za-z0-9_-]{43})/);
  expect(await page.getByTestId('invoice-balance').textContent()).toBe('$95.00');
});

it('the emailed link opens the invoice without signing in and goes to Stripe', async () => {
  const context = await smoke.browser.newContext({ baseURL: smoke.base });
  const anon = await context.newPage();
  await anon.route('https://checkout.stripe.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout</h1>' }));
  await anon.goto(`/pay/${token}`);
  await anon.getByRole('heading', { name: 'Invoice INV-1001' }).waitFor();
  await anon.getByText('Northwind IT').waitFor();
  expect(await anon.getByTestId('pay-balance').textContent()).toBe('$95.00');
  await anon.getByRole('button', { name: 'Pay $95.00 now' }).click();
  await anon.getByRole('heading', { name: 'Stripe Checkout' }).waitFor();
  await anon.goto('/pay/not-a-real-token-at-all-000000');
  await anon.getByRole('alert').getByText(/isn't valid/).waitFor();
  await context.close();
});

it('a check for part of it: partly paid', async () => {
  await page.goto('/money?tab=invoices');
  await page.getByTestId('invoices').getByText('INV-1001').click();
  const form = page.getByRole('form', { name: 'Record a payment' });
  await form.getByLabel('Payment amount').fill('50');
  await form.getByRole('button', { name: 'Record payment' }).click();
  await page.getByText('Payment recorded.').waitFor();
  await page.getByTestId('invoices').getByText('Partly paid').waitFor();
  expect(await page.getByTestId('invoice-balance').textContent()).toBe('$45.00');
});

it('the customer\'s portal admin sees it under Invoices', async () => {
  const context = await smoke.browser.newContext({ baseURL: smoke.base });
  const company = await models.Company.findByPk(alpha.id);
  const res = await context.request.post(`/api/v1/portal/c/${company.portalSlug}/auth/login`, { data: { email: dana.email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  const portal = await context.newPage();
  await portal.goto(`/portal/${company.portalSlug}/tickets`);
  await portal.getByRole('link', { name: 'Invoices' }).first().click();
  const list = portal.getByTestId('portal-invoices');
  await list.getByText('INV-1001').waitFor();
  await list.getByText('Partly paid').waitFor();
  await list.getByText('$45.00 to pay').waitFor();
  await context.close();
});

it('a technician sees no Money and no rates', async () => {
  const tech = await smoke.pageAs('tess');
  await tech.goto('/');
  await tech.getByRole('link', { name: /Tickets/ }).first().waitFor();
  expect(await tech.locator('a[href="/money"]').count()).toBe(0);
  await tech.goto('/money?tab=invoices');
  expect(await tech.getByTestId('invoices').count()).toBe(0);
});
