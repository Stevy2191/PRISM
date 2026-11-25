const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const { downFrom, upFrom } = require('./moneyMigrations');

// Phase 3, step 2, task 5: what the team spends directly (fuel, a tool from
// the hardware store), paid on the spot, with a photo of the receipt. An
// expense for a customer's job can be billed on to them later.

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let w;
let acme;
let ticket;
const a = () => w.admin.agent;
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));
const fuel = (extra = {}) => ({
  spentOn: '2026-12-03', account: '6200', description: 'Fuel, trip to Acme', amount: '62.40', paymentMethod: 'card', ...extra,
});
const record = async (extra) => expectOk(await a().post(`${API}/money/expenses`).send(fuel(extra)), 201).expense;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme Auto' });
  const ann = await makeContact(w.admin, { companyId: acme.id, firstName: 'Ann', lastName: 'A' });
  ticket = await makeTicket(a(), { title: 'Printer down', contactId: ann.id });
});
afterAll(closeDb);

it('records fuel paid by card, posted to Vehicle and Cash, with a receipt photo', async () => {
  const e = await record();
  expect(e).toMatchObject({
    spentOn: '2026-12-03', account: '6200', amount: '62.40', paymentMethod: 'card', billingStatus: 'non_billable', voided: false,
  });
  const b = await bal();
  expect(b['6200']).toBe('62.40');
  expect(b['1000']).toBe('-62.40');
  expectOk(await a().post(`${API}/money/expenses/${e.id}/receipt`).attach('file', PNG, 'receipt.png'), 201);
  const got = await a().get(`${API}/money/expenses/${e.id}/receipt`);
  expect(got.status).toBe(200);
  expect(got.headers['content-disposition']).toMatch(/attachment/);
  expect((await a().post(`${API}/money/expenses/${e.id}/receipt`).attach('file', Buffer.from('MZ'), 'x.exe')).status).toBe(400);
  expect(expectOk(await a().get(`${API}/money/expenses?account=6200`)).expenses).toHaveLength(1);
});

it('an expense billed on to a customer\'s ticket is unbilled, and carries the customer', async () => {
  const e = await record({ ticketId: ticket.id, rebillable: true, account: '6300', description: 'Toner from Staples', amount: '89.99' });
  expect(e).toMatchObject({ ticketId: ticket.id, rebillable: true, billingStatus: 'unbilled' });
  const entry = await models.LedgerEntry.findByPk((await models.Expense.findByPk(e.id)).ledgerEntryId);
  expect(entry).toMatchObject({ sourceType: 'expense', sourceId: e.id, companyId: acme.id });
  expect(expectOk(await a().get(`${API}/money/expenses?ticketId=${ticket.id}`)).expenses).toHaveLength(1);
});

it('void reverses it; the amount is never edited; a billed expense can\'t be voided', async () => {
  const e = await record();
  expect((await a().patch(`${API}/money/expenses/${e.id}`).send({ amount: '70.00' })).status).toBe(400);
  expect(expectOk(await a().patch(`${API}/money/expenses/${e.id}`).send({ description: 'Fuel, Acme and back' })).expense.description).toBe('Fuel, Acme and back');
  expect(expectOk(await a().post(`${API}/money/expenses/${e.id}/void`).send({})).expense.voided).toBe(true);
  const b = await bal();
  expect(b['6200']).toBe('0.00');
  expect(b['1000']).toBe('0.00');
  expect((await a().post(`${API}/money/expenses/${e.id}/void`).send({})).status).toBe(409);

  const billed = await record({ ticketId: ticket.id, rebillable: true });
  await models.Expense.update({ billingStatus: 'billed' }, { where: { id: billed.id } });
  expect((await a().post(`${API}/money/expenses/${billed.id}/void`).send({})).status).toBe(409);
});

it('checks the expense', async () => {
  const send = (extra) => a().post(`${API}/money/expenses`).send(fuel(extra));
  expect((await send({ account: '4000' })).status).toBe(400);
  expect((await send({ amount: '0' })).status).toBe(400);
  expect((await send({ amount: '-3' })).status).toBe(400);
  expect((await send({ spentOn: 'yesterday' })).status).toBe(400);
  expect((await send({ description: '' })).status).toBe(400);
  expect((await send({ rebillable: true })).status).toBe(400); // billed on to whom?
  expect((await send({ vendorCompanyId: acme.id })).status).toBe(400); // not a vendor
  expect(await models.Expense.count()).toBe(0);
});

it('technicians can\'t see or record expenses', async () => {
  await record();
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/expenses`)).status).toBe(403);
  expect((await tech.agent.post(`${API}/money/expenses`).send(fuel())).status).toBe(403);
});

it('merging tickets and vendors moves expenses, bills and purchase orders along', async () => {
  const shop = await makeCompany(w.admin, { name: 'Staples', isClient: false, isVendor: true });
  const shop2 = await makeCompany(w.admin, { name: 'Staples Inc', isClient: false, isVendor: true });
  const e = await record({ ticketId: ticket.id, rebillable: true, vendorCompanyId: shop.id });
  const po = expectOk(await a().post(`${API}/money/purchase-orders`).send({
    vendorCompanyId: shop.id, ticketId: ticket.id, lines: [{ description: 'Toner', quantity: '1', unitCost: '89.99' }],
  }), 201).purchaseOrder;
  const bill = expectOk(await a().post(`${API}/money/bills`).send({
    vendorCompanyId: shop.id, billNumber: 'S-1', billDate: '2026-12-01', total: '10.00', lines: [{ kind: 'materials', description: 'x', amount: '10.00', ticketId: ticket.id }],
  }), 201).bill;
  const other = await makeTicket(a(), { title: 'Printer still down', contactId: (await models.Ticket.findByPk(ticket.id)).contactId });
  expectOk(await a().post(`${API}/tickets/${other.id}/merge`).send({ sourceIds: [ticket.id] }));
  expect((await models.Expense.findByPk(e.id)).ticketId).toBe(other.id);
  expect((await models.PurchaseOrder.findByPk(po.id)).ticketId).toBe(other.id);
  expect((await models.BillLine.findOne({ where: { billId: bill.id } })).ticketId).toBe(other.id);

  expectOk(await a().post(`${API}/companies/${shop.id}/merge`).send({ intoCompanyId: shop2.id }));
  expect((await models.Expense.findByPk(e.id)).vendorCompanyId).toBe(shop2.id);
  expect((await models.PurchaseOrder.findByPk(po.id)).vendorCompanyId).toBe(shop2.id);
});

it('migration 113 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000113');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('Expenses');
  await upFrom('20260101000113');
  expect((await qi.describeTable('Expenses')).rebillable).toBeDefined();
});
