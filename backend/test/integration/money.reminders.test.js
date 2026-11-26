jest.mock('../../src/services/emailSender');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const reminders = require('../../src/services/money/reminders');
const { sendMail } = require('../../src/services/emailSender');
const { invalidateAllPermissions } = require('../../src/services/permissionService');

// Phase 3, step 3, task 5: reminders before the due date and at 7 and 30
// days late, each sent once; an optional late fee, off by default.

let w;
let alpha;
let inv;
const a = () => w.admin.agent;
const sentInvoice = async (price = '145') => {
  const draft = expectOk(await a().post(`${API}/money/invoices`).send({
    companyId: alpha.id, billToContactId: (await models.Contact.findOne({ where: { email: 'dana@alpha.test' } })).id, lines: [{ kind: 'fee', description: 'Onboarding', quantity: '1', unitPrice: price }],
  }), 201).invoice;
  return expectOk(await a().post(`${API}/money/invoices/${draft.id}/send`).send({ issuedOn: '2027-01-01' })).invoice;
};
const stagesOn = async (today) => (await reminders.sendDueReminders({ today })).sent.map((s) => s.stage);

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  await makeContact(w.admin, { firstName: 'Dana', lastName: 'Diaz', email: 'dana@alpha.test', companyId: alpha.id });
  inv = await sentInvoice(); // due 2027-01-31
  sendMail.mockClear();
});
afterAll(closeDb);

it('reminds 3 days before, then 7 and 30 days late — each once', async () => {
  expect(await stagesOn('2027-01-27')).toEqual([]);
  expect(await stagesOn('2027-01-28')).toEqual(['before']);
  expect(await stagesOn('2027-01-29')).toEqual([]);
  expect(await stagesOn('2027-02-06')).toEqual([]);
  expect(await stagesOn('2027-02-07')).toEqual(['late7']);
  expect(await stagesOn('2027-02-08')).toEqual([]);
  expect(await stagesOn('2027-03-02')).toEqual(['late30']);
  expect(await stagesOn('2027-03-03')).toEqual([]);
  expect(sendMail).toHaveBeenCalledTimes(3);
  const [late] = sendMail.mock.calls[1];
  expect(late.to).toEqual(['dana@alpha.test']);
  expect(late.subject).toContain(inv.number);
  expect(late.html).toMatch(/\/pay\/[A-Za-z0-9_-]{43}/);
});

it('a reminder missed while PRISM was down: only the latest one goes', async () => {
  expect(await stagesOn('2027-03-05')).toEqual(['late30']);
  expect(await stagesOn('2027-03-06')).toEqual([]);
});

it('paid and void invoices get no reminders', async () => {
  await a().post(`${API}/money/invoices/${inv.id}/payments`).send({ method: 'check', amount: '145', receivedOn: '2027-01-20' }).expect(201);
  const other = await sentInvoice('50');
  await a().post(`${API}/money/invoices/${other.id}/void`).send({ reason: 'x' }).expect(200);
  sendMail.mockClear(); // the second invoice's own email
  expect(await stagesOn('2027-02-07')).toEqual([]);
  expect(sendMail).not.toHaveBeenCalled();
});

it('late fees are off by default', async () => {
  expect((await reminders.applyLateFees({ today: '2027-03-02' })).charged).toEqual([]);
  expect(await models.Invoice.count()).toBe(1);
});

it('a flat late fee after 30 days: one fee invoice, never two', async () => {
  for (const [key, value] of [['money.lateFeeType', 'flat'], ['money.lateFeeAmount', '25'], ['money.lateFeeAfterDays', '30']]) {
    await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  }
  expect((await reminders.applyLateFees({ today: '2027-03-01' })).charged).toEqual([]);
  const { charged } = await reminders.applyLateFees({ today: '2027-03-02' });
  expect(charged).toEqual([{ invoiceId: inv.id, feeInvoiceId: expect.any(Number), amount: '25.00' }]);
  await reminders.applyLateFees({ today: '2027-03-03' });
  expect(await models.Invoice.count({ where: { id: { [require('sequelize').Op.ne]: inv.id } } })).toBe(1);
  const fee = await models.Invoice.findByPk(charged[0].feeInvoiceId, { include: ['lines'] });
  expect(fee).toMatchObject({ status: 'sent' });
  expect(fee.lines[0].kind).toBe('late_fee');
  expect((await models.Invoice.findByPk(inv.id)).lateFeeInvoiceId).toBe(fee.id);
  const b = Object.fromEntries((await ledger.balances()).map((x) => [x.code, x.balance]));
  expect(b['4300']).toBe('170.00'); // the onboarding fee and the late fee
});

it('a percent late fee is a share of what is still owed', async () => {
  await a().post(`${API}/money/invoices/${inv.id}/payments`).send({ method: 'check', amount: '45', receivedOn: '2027-01-20' }).expect(201);
  for (const [key, value] of [['money.lateFeeType', 'percent'], ['money.lateFeeAmount', '1.5']]) {
    await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  }
  expect((await reminders.applyLateFees({ today: '2027-03-02' })).charged[0].amount).toBe('1.50');
});

it('late fee settings are checked', async () => {
  expect((await a().put(`${API}/money/settings`).send({ lateFeeType: 'sometimes' })).status).toBe(400);
  expect((await a().put(`${API}/money/settings`).send({ lateFeeType: 'percent', lateFeeAmount: '30' })).status).toBe(400);
  expect((await a().put(`${API}/money/settings`).send({ reminderDaysLate: [7, 'x'] })).status).toBe(400);
  expectOk(await a().put(`${API}/money/settings`).send({
    lateFeeType: 'flat', lateFeeAmount: '25', lateFeeAfterDays: 45, reminderDaysBefore: 5, reminderDaysLate: [10, 45],
  }));
  expect(await stagesOn('2027-01-26')).toEqual(['before']);
});

it('with Customer billing off, nothing is sent or charged', async () => {
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  await models.SystemSettings.upsert({ key: 'money.lateFeeType', value: 'flat' });
  await models.SystemSettings.upsert({ key: 'money.lateFeeAmount', value: '25' });
  expect(await reminders.runReminders({ today: '2027-03-02' })).toEqual({ ran: false });
  expect(sendMail).not.toHaveBeenCalled();
  expect(await models.Invoice.count()).toBe(1);
});
