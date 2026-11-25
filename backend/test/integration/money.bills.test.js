const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech, setCompanyAccess,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { downFrom, upFrom } = require('./moneyMigrations');
const migration = require('../../migrations/20260101000109-bills');

// Phase 3, step 2, task 1: contractor and supplier bills, linked to tickets.
// Eric (Hale Communication) invoices for HR's network drop; the bill goes on
// the ticket, is entered into Tyler Incode, then paid.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
let w;
let hale;
let supplier;
let hr;
let ticket;
const a = () => w.admin.agent;
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));
const billBody = (extra = {}) => ({
  vendorCompanyId: hale.id,
  billNumber: 'H-1042',
  billDate: '2026-12-01',
  dueDate: '2026-12-31',
  total: '1250.00',
  lines: [{ kind: 'contractor', description: 'Network drop, HR office', amount: '1250.00', ticketId: ticket.id }],
  ...extra,
});
const makeBill = async (extra) => expectOk(await a().post(`${API}/money/bills`).send(billBody(extra)), 201).bill;

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  hale = await makeCompany(w.admin, { name: 'Hale Communication', isClient: false, isVendor: true });
  supplier = await makeCompany(w.admin, { name: 'CDW', isClient: false, isVendor: true });
  hr = await makeContact(w.admin, { firstName: 'Hana', lastName: 'Ruiz', companyId: w.contact.companyId });
  ticket = await makeTicket(a(), { title: 'New network drop for HR', contactId: hr.id });
});
afterAll(closeDb);

it('a vendor can be marked as getting a 1099; a customer can\'t', async () => {
  expect(expectOk(await a().patch(`${API}/companies/${hale.id}`).send({ is1099: true })).company.is1099).toBe(true);
  const customer = await makeCompany(w.admin, { name: 'Acme' });
  expect((await a().patch(`${API}/companies/${customer.id}`).send({ is1099: true })).status).toBe(400);
});

it('records a bill on the ticket, enters it with the Incode number, pays it', async () => {
  const bill = await makeBill();
  expect(bill).toMatchObject({ status: 'received', total: '1250.00', billNumber: 'H-1042' });
  expect(bill.lines[0]).toMatchObject({ kind: 'contractor', amount: '1250.00', ticketId: ticket.id });
  expect((await bal())['2000']).toBe('0.00'); // nothing owed until entered

  const entered = expectOk(await a().post(`${API}/money/bills/${bill.id}/enter`).send({ externalRef: 'INC-5521' })).bill;
  expect(entered).toMatchObject({ status: 'entered', externalRef: 'INC-5521' });
  let b = await bal();
  expect(b['5100']).toBe('1250.00');
  expect(b['2000']).toBe('1250.00');

  const paid = expectOk(await a().post(`${API}/money/bills/${bill.id}/pay`).send({ paidOn: '2026-12-15', paidMethod: 'check', paidRef: '3301' })).bill;
  expect(paid).toMatchObject({ status: 'paid', paidOn: '2026-12-15', paidMethod: 'check', paidRef: '3301' });
  b = await bal();
  expect(b['2000']).toBe('0.00');
  expect(b['1000']).toBe('-1250.00');
  expect((await a().post(`${API}/money/bills/${bill.id}/pay`).send({ paidOn: '2026-12-16', paidMethod: 'check' })).status).toBe(409);

  // The ticket lists it.
  const onTicket = expectOk(await a().get(`${API}/tickets/${ticket.id}/bills`)).bills;
  expect(onTicket.map((x) => x.billNumber)).toEqual(['H-1042']);
});

it('voiding a paid bill reverses everything', async () => {
  const bill = await makeBill();
  await a().post(`${API}/money/bills/${bill.id}/enter`).send({}).expect(200);
  await a().post(`${API}/money/bills/${bill.id}/pay`).send({ paidOn: '2026-12-15', paidMethod: 'check' }).expect(200);
  expectOk(await a().post(`${API}/money/bills/${bill.id}/void`).send({ reason: 'Sent twice' }));
  const b = await bal();
  for (const code of ['2000', '5100', '1000']) expect(b[code]).toBe('0.00');
  expect((await a().post(`${API}/money/bills/${bill.id}/pay`).send({ paidOn: '2026-12-16', paidMethod: 'check' })).status).toBe(409);
});

it('checks the bill: lines add up, positive amounts, one number per vendor, no edits once entered', async () => {
  const send = (extra) => a().post(`${API}/money/bills`).send(billBody(extra));
  expect((await send({ total: '1000.00' })).status).toBe(400);
  expect((await send({ lines: [{ kind: 'contractor', description: 'x', amount: '-5.00' }], total: '-5.00' })).status).toBe(400);
  expect((await send({ lines: [] , total: '0.00' })).status).toBe(400);
  expect((await send({ lines: [{ kind: 'expense', description: 'Tools', amount: '1250.00' }] })).status).toBe(400); // no account
  expect((await send({ lines: [{ kind: 'expense', expenseAccount: '4000', description: 'Tools', amount: '1250.00' }] })).status).toBe(400);
  expect((await send({ vendorCompanyId: (await makeCompany(w.admin, { name: 'Not a vendor' })).id })).status).toBe(400);
  const bill = await makeBill();
  expect((await send()).status).toBe(409);
  await makeBill({ vendorCompanyId: supplier.id }); // another vendor may use the same number
  expectOk(await a().patch(`${API}/money/bills/${bill.id}`).send({ notes: 'Eric, Hale Communication' }));
  await a().post(`${API}/money/bills/${bill.id}/enter`).send({}).expect(200);
  expect((await a().patch(`${API}/money/bills/${bill.id}`).send({ total: '1.00', lines: [{ kind: 'contractor', description: 'x', amount: '1.00' }] })).status).toBe(409);
});

it('posts each kind of line to its account', async () => {
  const bill = await makeBill({
    vendorCompanyId: supplier.id,
    billNumber: 'CDW-77',
    total: '600.00',
    lines: [
      { kind: 'materials', description: 'Patch panel', amount: '100.00', ticketId: ticket.id },
      { kind: 'stock', description: 'Cat6 box', amount: '180.00' },
      { kind: 'expense', expenseAccount: '6300', description: 'Crimper', amount: '320.00' },
    ],
  });
  await a().post(`${API}/money/bills/${bill.id}/enter`).send({}).expect(200);
  const b = await bal();
  expect([b['5000'], b['1200'], b['6300'], b['2000']]).toEqual(['100.00', '180.00', '320.00', '600.00']);
});

it('keeps the vendor\'s PDF; refuses other files', async () => {
  const bill = await makeBill();
  expectOk(await a().post(`${API}/money/bills/${bill.id}/file`).attach('file', PDF, 'H-1042.pdf'), 201);
  const got = await a().get(`${API}/money/bills/${bill.id}/file`);
  expect(got.status).toBe(200);
  expect(got.headers['content-disposition']).toMatch(/attachment/);
  expect((await a().post(`${API}/money/bills/${bill.id}/file`).attach('file', Buffer.from('MZ'), 'x.exe')).status).toBe(400);
});

it('fences bills: technicians see none and no amounts; lines only on reachable jobs', async () => {
  await makeBill();
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/bills`)).status).toBe(403);
  const theirs = await tech.agent.get(`${API}/tickets/${ticket.id}/bills`);
  if (theirs.status === 200) expect(JSON.stringify(theirs.body)).not.toMatch(/1250/);
  else expect(theirs.status).toBe(403);

  const clerk = await makeTech('cleo', w.deptA.id);
  await models.UserPermissionOverride.create({ userId: clerk.user.id, permissionKey: 'money.bills.manage', granted: true });
  invalidateAllPermissions();
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  await setCompanyAccess(w.admin, clerk.user.id, { allCompanies: false, companyIds: [other.id] });
  const res = await clerk.agent.post(`${API}/money/bills`).send(billBody({ billNumber: 'H-2000' }));
  expect(res.status).toBe(400);
});

it('merging a vendor moves its bills', async () => {
  const bill = await makeBill();
  const merged = await makeCompany(w.admin, { name: 'Hale Comms LLC', isClient: false, isVendor: true });
  expectOk(await a().post(`${API}/companies/${hale.id}/merge`).send({ intoCompanyId: merged.id }));
  expect((await models.Bill.findByPk(bill.id)).vendorCompanyId).toBe(merged.id);
});

it('migration 109 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000109');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('Bills');
  expect((await qi.describeTable('Companies')).is1099).toBeUndefined();
  await upFrom('20260101000109');
  expect((await qi.describeTable('Companies')).is1099).toBeDefined();
});
