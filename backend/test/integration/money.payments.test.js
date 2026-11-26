jest.mock('../../src/services/emailSender');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeTech,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { downFrom, upFrom } = require('./moneyMigrations');

// Phase 3, step 3, task 4: payments by hand. Partial payments, overpayment
// into customer credit, credit applied to the next invoice or refunded,
// refunds that re-open an invoice — every one posted.

let w;
let alpha;
const a = () => w.admin.agent;
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));
const sentInvoice = async (price, issuedOn = '2027-01-01') => {
  const draft = expectOk(await a().post(`${API}/money/invoices`).send({
    companyId: alpha.id, lines: [{ kind: 'fee', description: 'Onboarding', quantity: '1', unitPrice: price }],
  }), 201).invoice;
  return expectOk(await a().post(`${API}/money/invoices/${draft.id}/send`).send({ issuedOn })).invoice;
};
const pay = (inv, body) => a().post(`${API}/money/invoices/${inv.id}/payments`).send({
  method: 'check', receivedOn: '2027-01-10', ...body,
});
const credit = async () => expectOk(await a().get(`${API}/companies/${alpha.id}/credit`)).credit;

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
});
afterAll(closeDb);

it('a check for part, then the rest and more: partly paid, paid, and the excess becomes credit', async () => {
  const inv = await sentInvoice('145');
  const first = expectOk(await pay(inv, { amount: '100', reference: '1201' }), 201);
  expect(first.invoice).toMatchObject({ status: 'partly_paid', amountPaid: '100.00', balance: '45.00' });
  expect(first.payment).toMatchObject({ method: 'check', amount: '100.00', status: 'succeeded', reference: '1201' });
  let b = await bal();
  expect([b['1000'], b['1100']]).toEqual(['100.00', '45.00']);

  const second = expectOk(await pay(inv, { amount: '60' }), 201);
  expect(second.invoice).toMatchObject({ status: 'paid', amountPaid: '145.00', balance: '0.00' });
  b = await bal();
  expect([b['1000'], b['1100'], b['2200']]).toEqual(['160.00', '0.00', '15.00']);
  expect(await credit()).toBe('15.00');
});

it('credit pays part of the next invoice; what\'s left is refunded by check', async () => {
  const inv = await sentInvoice('145');
  await pay(inv, { amount: '160' }).expect(201);
  const next = await sentInvoice('50', '2027-02-01');
  const applied = expectOk(await a().post(`${API}/money/invoices/${next.id}/apply-credit`).send({ amount: '10' })).invoice;
  expect(applied).toMatchObject({ creditApplied: '10.00', balance: '40.00', status: 'partly_paid' });
  expect(await credit()).toBe('5.00');
  expect((await a().post(`${API}/money/invoices/${next.id}/apply-credit`).send({ amount: '6' })).status).toBe(400);

  expectOk(await a().post(`${API}/companies/${alpha.id}/credit/refund`).send({
    amount: '5', method: 'check', reference: '1202', reason: 'Overpaid',
  }), 201);
  expect(await credit()).toBe('0.00');
  const b = await bal();
  expect([b['2200'], b['1000']]).toEqual(['0.00', '155.00']);
  expect((await a().post(`${API}/companies/${alpha.id}/credit/refund`).send({ amount: '1', method: 'check', reason: 'x' })).status).toBe(400);
});

it('refunds: never more than was paid; a refund re-opens the invoice', async () => {
  const inv = await sentInvoice('160');
  const { payment } = expectOk(await pay(inv, { amount: '160' }), 201);
  expect((await a().post(`${API}/money/payments/${payment.id}/refund`).send({ amount: '200', reason: 'x' })).status).toBe(400);
  const res = expectOk(await a().post(`${API}/money/payments/${payment.id}/refund`).send({ amount: '45', reason: 'Returned a part', method: 'check' }), 201);
  expect(res.invoice).toMatchObject({ status: 'partly_paid', amountPaid: '115.00', balance: '45.00' });
  const b = await bal();
  expect([b['1000'], b['1100']]).toEqual(['115.00', '45.00']);
  expect((await a().post(`${API}/money/payments/${payment.id}/refund`).send({ amount: '115.01', reason: 'x' })).status).toBe(400);
});

it('an invoice with payments can\'t be voided', async () => {
  const inv = await sentInvoice('145');
  await pay(inv, { amount: '145' }).expect(201);
  const res = await a().post(`${API}/money/invoices/${inv.id}/void`).send({ reason: 'x' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('HAS_PAYMENTS');
});

it('checks each payment', async () => {
  const inv = await sentInvoice('145');
  for (const body of [{ amount: '0' }, { amount: '-5' }, { amount: 'abc' }, { amount: '10', method: 'card' }, { amount: '10', receivedOn: 'soon' }]) {
    expect((await pay(inv, body)).status).toBe(400); // eslint-disable-line no-await-in-loop
  }
  const draft = expectOk(await a().post(`${API}/money/invoices`).send({
    companyId: alpha.id, lines: [{ kind: 'fee', description: 'x', quantity: '1', unitPrice: '5' }],
  }), 201).invoice;
  expect((await pay(draft, { amount: '5' })).status).toBe(409);
  expect(await models.Payment.count()).toBe(0);
});

it('lists payments; fences them: technicians, the switch', async () => {
  const inv = await sentInvoice('145');
  await pay(inv, { amount: '145' }).expect(201);
  expect(expectOk(await a().get(`${API}/money/payments?companyId=${alpha.id}`)).payments).toHaveLength(1);
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/payments`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/companies/${alpha.id}/credit`)).status).toBe(403);
  expect((await tech.agent.post(`${API}/money/invoices/${inv.id}/payments`).send({ method: 'check', amount: '1', receivedOn: '2027-01-10' })).status).toBe(403);
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await a().get(`${API}/money/payments`)).status).toBe(404);
});

it('migration 117 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000117');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('Payments');
  expect(names).not.toContain('Refunds');
  await upFrom('20260101000117');
  expect((await qi.describeTable('Payments')).stripeSessionId).toBeDefined();
});
