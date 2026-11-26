jest.mock('../../src/services/emailSender');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp, createUserAndLogin, ROLE,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const stripe = require('../../src/services/money/stripe');
const { sendMail } = require('../../src/services/emailSender');
const { makeFakeStripe, signed } = require('./fakeStripe');
const { invalidateAllPermissions } = require('../../src/services/permissionService');

// Phase 3, step 3, task 4: the pay link and Stripe. The emailed link needs
// no sign-in and shows that invoice only; Stripe Checkout takes the money
// (card or US bank account); a signed webhook records it, once.

const WEBHOOK_SECRET = 'whsec_testsecret1234567890';
let w;
let alpha;
let dana;
let fake;
const a = () => w.admin.agent;
const anon = () => request(getApp());
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));

const sentInvoice = async (price = '145') => {
  const draft = expectOk(await a().post(`${API}/money/invoices`).send({
    companyId: alpha.id, billToContactId: dana.id, lines: [{ kind: 'fee', description: 'Onboarding', quantity: '1', unitPrice: price }],
  }), 201).invoice;
  sendMail.mockClear();
  const inv = expectOk(await a().post(`${API}/money/invoices/${draft.id}/send`).send({ issuedOn: '2027-01-01' })).invoice;
  const [mail] = sendMail.mock.calls[sendMail.mock.calls.length - 1];
  const token = mail.html.match(/\/pay\/([A-Za-z0-9_-]{43})/)[1];
  return { inv, token, mail };
};
const hook = (event) => {
  const { payload, header } = signed(event, WEBHOOK_SECRET);
  return anon().post(`${API}/money/stripe/webhook`).set('Stripe-Signature', header).set('Content-Type', 'application/json').send(payload);
};
const completed = (inv, extra = {}) => ({
  id: `evt_${inv.id}_done`,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_test_${inv.id}`, object: 'checkout.session', amount_total: 14500, currency: 'usd', payment_status: 'paid', payment_intent: `pi_${inv.id}`, metadata: { invoiceId: String(inv.id), fee: '0.00' }, ...extra,
    },
  },
});

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  sendMail.mockReset();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  await models.SystemSettings.upsert({ key: 'company.name', value: 'Northwind IT' });
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  dana = await makeContact(w.admin, { firstName: 'Dana', lastName: 'Diaz', email: 'dana@alpha.test', companyId: alpha.id });
  fake = makeFakeStripe();
  stripe.setClientForTests(fake);
  expectOk(await a().put(`${API}/money/settings/stripe`).send({ secretKey: 'sk_test_abcdefghijklmnop', webhookSecret: WEBHOOK_SECRET }));
});
afterAll(async () => { stripe.setClientForTests(null); await closeDb(); });

it('sending emails the invoice with its pay link and PDF', async () => {
  const { mail, inv } = await sentInvoice();
  expect(mail.to).toEqual(['dana@alpha.test']);
  expect(mail.subject).toContain(inv.number);
  expect(mail.attachments.map((x) => x.filename)).toContain(`${inv.number}.pdf`);
});

it('the link shows that invoice only, to anyone holding it, without signing in', async () => {
  const { token, inv } = await sentInvoice();
  await sentInvoice('99'); // another invoice of the same customer
  const shown = expectOk(await anon().get(`${API}/pay/${token}`));
  expect(shown.invoice).toMatchObject({ number: inv.number, total: '145.00', balance: '145.00', dueOn: '2027-01-31' });
  expect(shown.invoice.lines).toEqual([expect.objectContaining({ description: 'Onboarding', amount: '145.00' })]);
  expect(shown.business).toEqual({ name: 'Northwind IT' });
  const text = JSON.stringify(shown);
  expect(text).not.toMatch(/dana@alpha\.test|INV-1002|companyId|"id"/);
  const pdf = await anon().get(`${API}/pay/${token}/pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
});

it('an unknown, voided, paid or expired link gets the same answer', async () => {
  const { token, inv } = await sentInvoice();
  const answers = [];
  answers.push(await anon().get(`${API}/pay/not-a-real-token`));
  await models.Invoice.update({ payTokenExpiresAt: new Date(Date.now() - 1000) }, { where: { id: inv.id } });
  answers.push(await anon().get(`${API}/pay/${token}`));
  const two = await sentInvoice('50');
  await a().post(`${API}/money/invoices/${two.inv.id}/void`).send({ reason: 'x' }).expect(200);
  answers.push(await anon().get(`${API}/pay/${two.token}`));
  const three = await sentInvoice('20');
  await a().post(`${API}/money/invoices/${three.inv.id}/payments`).send({ method: 'check', amount: '20', receivedOn: '2027-01-02' }).expect(201);
  answers.push(await anon().get(`${API}/pay/${three.token}`));
  answers.push(await anon().post(`${API}/pay/${three.token}/checkout`).send({}));
  for (const res of answers) {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'PAY_LINK_INVALID', message: answers[0].body.message });
  }
});

it('checkout charges the balance the server works out, whatever the browser sends', async () => {
  const { token, inv } = await sentInvoice();
  const { url } = expectOk(await anon().post(`${API}/pay/${token}/checkout`).send({ amount: '1', unit_amount: 100 }));
  expect(url).toBe('https://checkout.stripe.test/cs_test_1');
  const session = fake.sessions[0];
  expect(session.line_items).toEqual([expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ currency: 'usd', unit_amount: 14500 }) })]);
  expect(session.payment_method_types).toEqual(['card', 'us_bank_account']);
  expect(session.metadata.invoiceId).toBe(String(inv.id));
  expect(session.success_url).not.toContain(token);
  expect(session.cancel_url).not.toContain(token);
});

it('an online-payment fee, when set, is its own line and income', async () => {
  await a().put(`${API}/money/settings`).send({ cardFeePercent: '3' }).expect(200);
  const { token, inv } = await sentInvoice();
  await anon().post(`${API}/pay/${token}/checkout`).send({}).expect(200);
  expect(fake.sessions[0].line_items.map((l) => l.price_data.unit_amount)).toEqual([14500, 435]);
  fake.intents[`pi_${inv.id}`] = { fee: 460 };
  await hook(completed(inv, { amount_total: 14935, metadata: { invoiceId: String(inv.id), fee: '4.35' } })).expect(200);
  const b = await bal();
  expect([b['1100'], b['4300'], b['1010'], b['6000']]).toEqual(['0.00', '149.35', '144.75', '4.60']);
});

it('a forged webhook records nothing', async () => {
  const { inv } = await sentInvoice();
  const payload = JSON.stringify(completed(inv));
  const res = await anon().post(`${API}/money/stripe/webhook`).set('Stripe-Signature', 't=1,v1=deadbeef').set('Content-Type', 'application/json').send(payload);
  expect(res.status).toBe(400);
  expect(await models.Payment.count()).toBe(0);
});

it('a card payment is recorded once, with Stripe\'s fee', async () => {
  const { inv } = await sentInvoice();
  fake.intents[`pi_${inv.id}`] = { fee: 451 };
  await hook(completed(inv)).expect(200);
  await hook(completed(inv)).expect(200);
  expect(await models.Payment.count()).toBe(1);
  const payment = await models.Payment.findOne();
  expect(payment).toMatchObject({ method: 'card', status: 'succeeded' });
  expect((await models.Invoice.findByPk(inv.id)).status).toBe('paid');
  const b = await bal();
  expect([b['1100'], b['1010'], b['6000']]).toEqual(['0.00', '140.49', '4.51']);
});

it('a bank transfer is pending until it clears; a failed one leaves the invoice due', async () => {
  const { inv } = await sentInvoice();
  await hook(completed(inv, { payment_status: 'unpaid', payment_method_types: ['us_bank_account'] })).expect(200);
  expect(await models.Payment.findOne()).toMatchObject({ status: 'pending', method: 'us_bank_account' });
  expect((await models.Invoice.findByPk(inv.id)).status).toBe('sent');
  await hook({ ...completed(inv), id: 'evt_ok', type: 'checkout.session.async_payment_succeeded' }).expect(200);
  expect(await models.Payment.findOne()).toMatchObject({ status: 'succeeded' });
  expect((await models.Invoice.findByPk(inv.id)).status).toBe('paid');

  const two = await sentInvoice('50');
  await hook(completed(two.inv, { payment_status: 'unpaid', amount_total: 5000 })).expect(200);
  await hook({ ...completed(two.inv, { amount_total: 5000 }), id: 'evt_fail', type: 'checkout.session.async_payment_failed' }).expect(200);
  expect(await models.Payment.findOne({ where: { invoiceId: two.inv.id } })).toMatchObject({ status: 'failed' });
  expect((await models.Invoice.findByPk(two.inv.id)).status).toBe('sent');
  expect((await bal())['1100']).toBe('50.00');
});

it('a refund made in Stripe is recorded once', async () => {
  const { inv } = await sentInvoice();
  await hook(completed(inv)).expect(200);
  fake.intents[`pi_${inv.id}`] = { refunds: [{ id: 're_dash_1', amount: 4500, status: 'succeeded' }] };
  const refunded = { id: 'evt_ref', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: `pi_${inv.id}` } } };
  await hook(refunded).expect(200);
  await hook(refunded).expect(200);
  expect(await models.Refund.count()).toBe(1);
  expect((await models.Invoice.findByPk(inv.id)).status).toBe('partly_paid');
  expect((await bal())['1100']).toBe('45.00');
});

it('a refund from PRISM goes through Stripe', async () => {
  const { inv } = await sentInvoice();
  await hook(completed(inv)).expect(200);
  const payment = await models.Payment.findOne();
  expectOk(await a().post(`${API}/money/payments/${payment.id}/refund`).send({ amount: '145', reason: 'Cancelled' }), 201);
  expect(fake.refundsMade).toEqual([expect.objectContaining({ amount: 14500, payment_intent: `pi_${inv.id}` })]);
  // Stripe then tells us about it: nothing new.
  await hook({ id: 'evt_r2', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: `pi_${inv.id}` } } }).expect(200);
  expect(await models.Refund.count()).toBe(1);
});

it('the keys are never shown, and only an Owner sets them', async () => {
  const shown = expectOk(await a().get(`${API}/money/settings`));
  expect(shown.settings).toMatchObject({ stripeConfigured: true, stripeWebhookConfigured: true });
  expect(JSON.stringify(shown)).not.toMatch(/sk_test|whsec_/);
  const other = await createUserAndLogin({ username: 'adam', roleName: ROLE.ADMIN, legacyRole: 'admin' });
  expect((await other.agent.put(`${API}/money/settings/stripe`).send({ secretKey: 'sk_test_zzzzzzzzzzzzzz' })).status).toBe(403);
  expect((await a().put(`${API}/money/settings/stripe`).send({ secretKey: 'not-a-key' })).status).toBe(400);
});

it('rate limits the link', async () => {
  let last;
  for (let i = 0; i < 31; i += 1) last = await anon().get(`${API}/pay/nothing-here-${i}`); // eslint-disable-line no-await-in-loop
  expect(last.status).toBe(429);
});

it('with Customer billing off, the link and the webhook don\'t exist', async () => {
  const { token, inv } = await sentInvoice();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await anon().get(`${API}/pay/${token}`)).status).toBe(404);
  expect((await hook(completed(inv))).status).toBe(404);
  expect(await models.Payment.count()).toBe(0);
});
