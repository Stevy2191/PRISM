jest.mock('../../src/services/emailSender');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const run = require('../../src/services/money/billingRun');
const reminders = require('../../src/services/money/reminders');
const stripe = require('../../src/services/money/stripe');
const { invoiceJson } = require('../../src/services/money/invoices');
const { sendMail } = require('../../src/services/emailSender');
const { makeFakeStripe, signed } = require('./fakeStripe');
const { invalidateAllPermissions } = require('../../src/services/permissionService');

// Phase 3, step 3: the fixes from the whole-step review. Each test is one
// finding: C1 and I1–I9.

const WEBHOOK_SECRET = 'whsec_testsecret1234567890';
let w;
let alpha;
let dana;
let ticket;
let remote;
let fake;
const a = () => w.admin.agent;
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));
const amounts = (inv) => inv.lines.map((l) => [l.kind, l.amount]);
const draft = async (companyId, opts) => invoiceJson(await run.draftForCompany(companyId, opts));
const log = (entryDate, minutes, extra = {}) => models.TimeEntry.create({
  ticketId: ticket.id, userId: w.admin.user.id, entryDate, durationSeconds: minutes * 60, workTypeId: remote.id, billable: true, ...extra,
});
const sentInvoice = async (price, extra = {}) => {
  const d = expectOk(await a().post(`${API}/money/invoices`).send({
    companyId: alpha.id, billToContactId: dana.id, lines: [{ kind: 'fee', description: 'Onboarding', quantity: '1', unitPrice: price }], ...extra,
  }), 201).invoice;
  return expectOk(await a().post(`${API}/money/invoices/${d.id}/send`).send({ issuedOn: '2027-01-01' })).invoice;
};
const prepaid = (extra = {}) => a().post(`${API}/money/agreements`).send({
  companyId: alpha.id,
  name: 'Ten hours a month',
  startsOn: '2026-11-01',
  lines: [{
    kind: 'prepaid_hours', description: 'Prepaid support block', unitPrice: '900', hours: '10', overageRate: '110', ...extra,
  }],
}).expect(201);
const hook = (event) => {
  const { payload, header } = signed(event, WEBHOOK_SECRET);
  return request(getApp()).post(`${API}/money/stripe/webhook`).set('Stripe-Signature', header).set('Content-Type', 'application/json').send(payload);
};
const session = (inv, cents, extra = {}) => ({
  id: `evt_${inv.id}_${cents}`,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_${inv.id}_${cents}`, amount_total: cents, currency: 'usd', payment_status: 'paid', payment_intent: `pi_${inv.id}`, metadata: { invoiceId: String(inv.id), fee: '0.00', source: 'prism' }, ...extra,
    },
  },
});

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  sendMail.mockReset();
  w = await makeWorld();
  for (const [key, value] of [['money.customerBilling', 'true'], ['money.hourlyRate', '100'], ['money.afterHoursRate', '150'], ['money.tripCharge', '45']]) {
    await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  }
  [remote] = await models.WorkType.findOrCreate({ where: { name: 'Fixes: remote' } });
  await remote.update({ onSite: false });
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  dana = await makeContact(w.admin, { firstName: 'Dana', lastName: 'Diaz', email: 'dana@alpha.test', companyId: alpha.id });
  ticket = await makeTicket(a(), { title: 'Printer', contactId: dana.id });
  fake = makeFakeStripe();
  stripe.setClientForTests(fake);
  expectOk(await a().put(`${API}/money/settings/stripe`).send({ secretKey: 'sk_test_abcdefghijklmnop', webhookSecret: WEBHOOK_SECRET }));
});
afterAll(async () => { stripe.setClientForTests(null); await closeDb(); });

it('C1: covered time on an invoice is locked — an edit can\'t free it to be billed again', async () => {
  await prepaid();
  const entry = await log('2026-12-02', 120);
  await draft(alpha.id, { runDate: '2027-01-01' });
  expect((await models.TimeEntry.findByPk(entry.id)).billingStatus).toBe('covered');
  const edit = await a().patch(`${API}/tickets/${ticket.id}/time/${entry.id}`).send({ note: 'typo', billable: true });
  expect(edit.status).toBe(409);
  expect((await a().delete(`${API}/tickets/${ticket.id}/time/${entry.id}`)).status).toBe(409);
  const fresh = await models.TimeEntry.findByPk(entry.id);
  expect(fresh.billingStatus).toBe('covered');
  const feb = await draft(alpha.id, { runDate: '2027-02-01' });
  expect(feb.lines.filter((l) => l.kind !== 'prepaid_hours')).toEqual([]);
});

it('C1: an edit that doesn\'t change billable leaves an unbilled entry\'s status alone', async () => {
  const entry = await log('2026-12-02', 60, { billable: false });
  expectOk(await a().patch(`${API}/tickets/${ticket.id}/time/${entry.id}`).send({ note: 'x', billable: false }));
  expect((await models.TimeEntry.findByPk(entry.id)).billingStatus).toBe('non_billable');
});

it('I1: a refund PRISM can\'t record never reaches Stripe; one made in Stripe is always recorded', async () => {
  const inv = await sentInvoice('145');
  await hook(session(inv, 16000)).expect(200); // $15 over: credit
  const other = await sentInvoice('15');
  await a().post(`${API}/money/invoices/${other.id}/apply-credit`).send({ amount: '15' }).expect(200);
  const payment = await models.Payment.findOne({ where: { invoiceId: inv.id } });
  expect((await a().post(`${API}/money/payments/${payment.id}/refund`).send({ amount: '160', reason: 'x' })).status).toBe(400);
  expect(fake.refundsMade).toEqual([]);
  // Done in Stripe's dashboard anyway: PRISM records what Stripe did.
  fake.intents[`pi_${inv.id}`] = { refunds: [{ id: 're_dash', amount: 16000, status: 'succeeded' }] };
  await hook({ id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: `pi_${inv.id}` } } }).expect(200);
  expect(await models.Refund.count()).toBe(1);
  expect((await bal())['2200']).toBe('-15.00');
});

it('I2: a rollover block is credited every month, worked or not; a deleted draft gives its hours back', async () => {
  await prepaid({ rollover: true });
  for (const day of ['2026-12-01', '2026-12-02', '2026-12-03']) await log(day, 300); // eslint-disable-line no-await-in-loop
  const jan = await draft(alpha.id, { runDate: '2027-01-01' });
  // November's 10 h rolled over: 20 h for December's 15 h, no overage.
  expect(jan.lines.filter((l) => l.kind === 'overage')).toEqual([]);
  await a().delete(`${API}/money/invoices/${jan.id}`).expect(200);
  const again = await draft(alpha.id, { runDate: '2027-01-01' });
  expect(again.lines.filter((l) => l.kind === 'overage')).toEqual([]);
});

it('I2: a per-job customer\'s tickets draw on one block for the month', async () => {
  await prepaid();
  await a().put(`${API}/companies/${alpha.id}/billing`).send({ invoiceTiming: 'on_close' }).expect(200);
  const closed = await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } });
  const second = await makeTicket(a(), { title: 'Scanner', contactId: dana.id });
  await log('2026-12-02', 360);
  await models.TimeEntry.create({
    ticketId: second.id, userId: w.admin.user.id, entryDate: '2026-12-03', durationSeconds: 360 * 60, workTypeId: remote.id, billable: true,
  });
  for (const t of [ticket, second]) await a().patch(`${API}/tickets/${t.id}`).send({ status: closed.name }).expect(200); // eslint-disable-line no-await-in-loop
  const firstInv = invoiceJson(await models.Invoice.findOne({ where: { ticketId: ticket.id }, include: ['lines'] }));
  const secondInv = invoiceJson(await models.Invoice.findOne({ where: { ticketId: second.id }, include: ['lines'] }));
  expect(amounts(firstInv)).toEqual([['covered', '0.00']]);
  // 4 h left of the 10: 2 h over at $110.
  expect(amounts(secondInv)).toEqual([['overage', '220.00']]);
});

it('I3: an agreement signed after the 1st gets its first days on the next run', async () => {
  // December's invoice went out on the 1st (event work), before the agreement.
  await log('2026-11-20', 30);
  await draft(alpha.id, { runDate: '2026-12-01' });
  await a().post(`${API}/money/agreements`).send({
    companyId: alpha.id, name: 'Managed', startsOn: '2026-12-15', lines: [{ kind: 'flat', description: 'Monitoring', unitPrice: '310' }],
  }).expect(201);
  const jan = await draft(alpha.id, { runDate: '2027-01-01' });
  // Dec 15–31 (17 of 31 days of $310 = $170) and January's $310.
  expect(amounts(jan)).toEqual([['agreement', '170.00'], ['agreement', '310.00']]);
  expect(jan.lines[0]).toMatchObject({ serviceFrom: '2026-12-15', serviceTo: '2026-12-31' });
  // Not twice.
  await a().delete(`${API}/money/invoices/${jan.id}`).expect(200);
  const again = await draft(alpha.id, { runDate: '2027-01-01' });
  expect(amounts(again)).toEqual([['agreement', '170.00'], ['agreement', '310.00']]);
});

it('I4: a credit note on an open invoice lowers what is owed on it', async () => {
  const inv = await sentInvoice('145');
  await a().post(`${API}/money/invoices/${inv.id}/credit-note`).send({
    reason: 'Waived', lines: [{ kind: 'fee', description: 'Waived', quantity: '1', unitPrice: '45' }],
  }).expect(201);
  const after = expectOk(await a().get(`${API}/money/invoices/${inv.id}`)).invoice;
  expect(after).toMatchObject({ balance: '100.00', creditApplied: '45.00', status: 'partly_paid' });
  const b = await bal();
  expect([b['1100'], b['2200']]).toEqual(['100.00', '0.00']);
});

it('I5: a reminder that isn\'t sent doesn\'t break the link the customer already has', async () => {
  const inv = await sentInvoice('145');
  const token = sendMail.mock.calls[0][0].html.match(/\/pay\/([A-Za-z0-9_-]{43})/)[1];
  sendMail.mockRejectedValue(new Error('SMTP down'));
  await reminders.sendDueReminders({ today: '2027-02-07' });
  await models.EmailTemplate.create({ key: 'invoice_reminder_late', subject: 'x', bodyHtml: 'x', enabled: false });
  await reminders.sendDueReminders({ today: '2027-03-02' });
  expect((await request(getApp()).get(`${API}/pay/${token}`)).status).toBe(200);
  expect(inv.number).toBe('INV-1001');
});

it('I6: a late-fee invoice doesn\'t get a late fee of its own', async () => {
  for (const [key, value] of [['money.lateFeeType', 'flat'], ['money.lateFeeAmount', '25'], ['money.lateFeeAfterDays', '30']]) {
    await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  }
  await sentInvoice('145');
  await reminders.applyLateFees({ today: '2027-03-02' });
  await reminders.applyLateFees({ today: '2027-06-30' });
  expect(await models.InvoiceLine.count({ where: { kind: 'late_fee' } })).toBe(1);
});

it('I7: a customer who has paid can be merged', async () => {
  const inv = await sentInvoice('145');
  await a().post(`${API}/money/invoices/${inv.id}/payments`).send({ method: 'check', amount: '160', receivedOn: '2027-01-02' }).expect(201);
  const pay = await models.Payment.findOne();
  await a().post(`${API}/companies/${alpha.id}/credit/refund`).send({ amount: '5', method: 'check', reason: 'x' }).expect(201);
  const kept = await makeCompany(w.admin, { name: 'Alpha Dental Group' });
  expectOk(await a().post(`${API}/companies/${alpha.id}/merge`).send({ intoCompanyId: kept.id }));
  expect((await models.Payment.findByPk(pay.id)).companyId).toBe(kept.id);
  expect(await models.Refund.count({ where: { companyId: kept.id } })).toBe(1);
});

it('I8: the billing run needs reach over every customer', async () => {
  const clerk = await makeTech('cleo', w.deptA.id);
  await models.UserPermissionOverride.create({ userId: clerk.user.id, permissionKey: 'money.billing.manage', granted: true });
  invalidateAllPermissions();
  await a().put(`${API}/users/${clerk.user.id}/company-access`).send({ allCompanies: false, companyIds: [alpha.id] }).expect(200);
  expect((await clerk.agent.get(`${API}/money/billing-run/preview?runDate=2027-01-01`)).status).toBe(403);
  expect((await clerk.agent.post(`${API}/money/billing-run`).send({ runDate: '2027-01-01' })).status).toBe(403);
});

it('I9: the webhook takes only sessions PRISM started, in its currency', async () => {
  const inv = await sentInvoice('145');
  await hook(session(inv, 14500, { metadata: undefined, client_reference_id: String(inv.id) })).expect(200);
  await hook(session(inv, 14501, { metadata: { invoiceId: String(inv.id) } })).expect(200);
  await hook(session(inv, 14502, { currency: 'eur' })).expect(200);
  expect(await models.Payment.count()).toBe(0);
  const { url } = expectOk(await request(getApp()).post(`${API}/pay/${sendMail.mock.calls[0][0].html.match(/\/pay\/([A-Za-z0-9_-]{43})/)[1]}/checkout`).send({}));
  expect(url).toBeTruthy();
  expect(fake.sessions[0].metadata.source).toBe('prism');
});
