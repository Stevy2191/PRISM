const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { downFrom, upFrom } = require('./moneyMigrations');

// Phase 3, step 3, task 2: invoices. A draft gathers lines (billable time,
// materials, fees); its lines and tax always add up; sending numbers it,
// sets the due date from the terms and posts it; void and credit notes
// correct it. Whatever an invoice bills is claimed by it and locked.

let w;
let alpha;
let ticket;
let tax;
let entries;
let material;
const a = () => w.admin.agent;
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));
const cat = (name) => tax.find((c) => c.name === name).id;

const draftBody = (extra = {}) => ({
  companyId: alpha.id,
  lines: [
    { kind: 'labor', description: 'Remote support, 1.5 h', quantity: '1.5', unitPrice: '100', taxCategoryId: cat('Remote support'), timeEntryIds: [entries[0].id] },
    { kind: 'trip', description: 'Trip charge', quantity: '1', unitPrice: '45', taxCategoryId: cat('On-site labor'), timeEntryIds: [entries[1].id] },
    { kind: 'material', description: 'Patch panel', quantity: '1', unitPrice: '89', materialIds: [material.id] },
  ],
  ...extra,
});
const makeDraft = async (extra) => expectOk(await a().post(`${API}/money/invoices`).send(draftBody(extra)), 201).invoice;

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  await models.SystemSettings.upsert({ key: 'company.name', value: 'Northwind IT' });
  tax = await models.TaxCategory.findAll();
  // One rate for the business: 8.25 %.
  await models.TaxRate.create({ name: 'Austin', ratePercent: '8.25', isDefault: true, active: true });
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  const dana = await makeContact(w.admin, { firstName: 'Dana', lastName: 'Diaz', companyId: alpha.id });
  ticket = await makeTicket(a(), { title: 'Front desk PC', contactId: dana.id });
  const workType = await models.WorkType.findOne();
  entries = [];
  for (const seconds of [5400, 1800]) {
    // eslint-disable-next-line no-await-in-loop
    entries.push(await models.TimeEntry.create({
      ticketId: ticket.id, userId: w.admin.user.id, entryDate: '2026-12-10', durationSeconds: seconds, workTypeId: workType.id, billable: true,
    }));
  }
  material = await models.ProjectMaterial.create({
    ticketId: ticket.id, itemName: 'Patch panel', quantity: '1', unitPrice: '89.0000', taxCategoryId: cat('Parts and equipment'), addedBy: w.admin.user.id,
  });
});
afterAll(closeDb);

it('a draft\'s lines and tax add up exactly; what it bills is claimed', async () => {
  const inv = await makeDraft();
  expect(inv).toMatchObject({ status: 'draft', number: null, kind: 'invoice' });
  expect(inv.lines.map((l) => [l.amount, l.tax])).toEqual([
    // 150.00 × 80 % taxable × 8.25 % = 9.90; 45.00 × 100 % → 3.71; 89.00 → 7.34
    ['150.00', '9.90'], ['45.00', '3.71'], ['89.00', '7.34'],
  ]);
  expect(inv).toMatchObject({ subtotal: '284.00', taxTotal: '20.95', total: '304.95' });
  expect((await models.TimeEntry.findByPk(entries[0].id)).billingStatus).toBe('billed');
  expect((await models.ProjectMaterial.findByPk(material.id)).billingStatus).toBe('billed');
  // Claimed time is locked like any billed time.
  const edit = await a().patch(`${API}/tickets/${ticket.id}/time/${entries[0].id}`).send({ note: 'x' });
  expect(edit.status).toBe(409);
});

it('nothing is billed twice: a claimed entry can\'t go on another draft, and nothing is claimed', async () => {
  await makeDraft();
  const res = await a().post(`${API}/money/invoices`).send(draftBody({
    lines: [{ kind: 'labor', description: 'Again', quantity: '1', unitPrice: '100', taxCategoryId: cat('Remote support'), timeEntryIds: [entries[0].id] }],
  }));
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('ALREADY_BILLED');
  expect(await models.Invoice.count()).toBe(1);
});

it('another company\'s time can\'t be put on this company\'s invoice', async () => {
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  const res = await a().post(`${API}/money/invoices`).send(draftBody({ companyId: beta.id }));
  expect(res.status).toBe(400);
  expect(await models.Invoice.count()).toBe(0);
  expect((await models.TimeEntry.findByPk(entries[0].id)).billingStatus).toBe('unbilled');
});

it('deleting a draft releases what it billed', async () => {
  const inv = await makeDraft();
  expectOk(await a().delete(`${API}/money/invoices/${inv.id}`));
  expect((await models.TimeEntry.findByPk(entries[0].id)).billingStatus).toBe('unbilled');
  expect((await models.TimeEntry.findByPk(entries[0].id)).invoiceLineId).toBeNull();
  expect((await models.ProjectMaterial.findByPk(material.id)).billingStatus).toBe('unbilled');
});

it('sending numbers it, sets the due date from the terms and posts it; then it can\'t change', async () => {
  const inv = await makeDraft();
  const sent = expectOk(await a().post(`${API}/money/invoices/${inv.id}/send`).send({ issuedOn: '2027-01-01' })).invoice;
  expect(sent).toMatchObject({ status: 'sent', number: 'INV-1001', issuedOn: '2027-01-01', dueOn: '2027-01-31' });
  const b = await bal();
  expect([b['1100'], b['4100'], b['4200'], b['2100']]).toEqual(['304.95', '195.00', '89.00', '20.95']);
  expect((await a().patch(`${API}/money/invoices/${inv.id}`).send({ notes: 'x' })).status).toBe(409);
  expect((await a().delete(`${API}/money/invoices/${inv.id}`)).status).toBe(409);
  expect((await a().post(`${API}/money/invoices/${inv.id}/send`).send({})).status).toBe(409);

  const second = await makeDraft({ lines: [{ kind: 'fee', description: 'Setup fee', quantity: '1', unitPrice: '25' }] });
  expect(expectOk(await a().post(`${API}/money/invoices/${second.id}/send`).send({ issuedOn: '2027-01-02' })).invoice.number).toBe('INV-1002');
});

it('the prefix and the next number are settings; the number only goes up', async () => {
  expectOk(await a().put(`${API}/money/settings`).send({ invoicePrefix: 'nw-', invoiceNextNumber: 5000 }));
  const inv = await makeDraft();
  expect(expectOk(await a().post(`${API}/money/invoices/${inv.id}/send`).send({ issuedOn: '2027-01-01' })).invoice.number).toBe('NW-5000');
  expect((await a().put(`${API}/money/settings`).send({ invoiceNextNumber: 4000 })).status).toBe(400);
  expect((await a().put(`${API}/money/settings`).send({ invoicePrefix: 'bad prefix!' })).status).toBe(400);
});

it('voiding reverses the posting and releases what it billed', async () => {
  const inv = await makeDraft();
  await a().post(`${API}/money/invoices/${inv.id}/send`).send({ issuedOn: '2027-01-01' }).expect(200);
  const voided = expectOk(await a().post(`${API}/money/invoices/${inv.id}/void`).send({ reason: 'Wrong customer' })).invoice;
  expect(voided.status).toBe('void');
  const b = await bal();
  for (const code of ['1100', '4100', '4200', '2100']) expect(b[code]).toBe('0.00');
  expect((await models.TimeEntry.findByPk(entries[0].id)).billingStatus).toBe('unbilled');
  expect((await a().post(`${API}/money/invoices/${inv.id}/void`).send({ reason: 'again' })).status).toBe(409);
});

it('a credit note credits the customer, never more than the invoice', async () => {
  const inv = await makeDraft();
  await a().post(`${API}/money/invoices/${inv.id}/send`).send({ issuedOn: '2027-01-01' }).expect(200);
  const credit = expectOk(await a().post(`${API}/money/invoices/${inv.id}/credit-note`).send({
    reason: 'Trip charge waived', lines: [{ kind: 'trip', description: 'Trip charge waived', quantity: '1', unitPrice: '45', taxCategoryId: cat('On-site labor') }],
  }), 201).invoice;
  expect(credit).toMatchObject({ kind: 'credit_note', status: 'sent', number: 'CN-1001', total: '48.71', creditForInvoiceId: inv.id });
  const b = await bal();
  expect([b['4100'], b['2100'], b['2200']]).toEqual(['150.00', '17.24', '48.71']);
  const tooMuch = await a().post(`${API}/money/invoices/${inv.id}/credit-note`).send({
    reason: 'x', lines: [{ kind: 'fee', description: 'x', quantity: '1', unitPrice: '300', taxCategoryId: cat('Fees') }],
  });
  expect(tooMuch.status).toBe(400);
  const listed = expectOk(await a().get(`${API}/money/invoices/${inv.id}`)).invoice;
  expect(listed.creditNotes.map((c) => c.number)).toEqual(['CN-1001']);
});

it('tax left off for this customer, or on this invoice', async () => {
  await a().put(`${API}/companies/${alpha.id}/billing`).send({ chargeTax: false }).expect(200);
  const inv = await makeDraft();
  expect(inv).toMatchObject({ chargeTax: false, taxTotal: '0.00', total: '284.00' });
  const on = expectOk(await a().patch(`${API}/money/invoices/${inv.id}`).send({ chargeTax: true })).invoice;
  expect(on.taxTotal).toBe('20.95');
});

it('the PDF names the invoice', async () => {
  const inv = await makeDraft();
  await a().post(`${API}/money/invoices/${inv.id}/send`).send({ issuedOn: '2027-01-01' }).expect(200);
  const res = await a().get(`${API}/money/invoices/${inv.id}/pdf`).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-disposition']).toMatch(/INV-1001\.pdf/);
  expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  expect(res.body.toString('latin1')).toContain('INV-1001');
});

it('fences invoices: technicians, other companies, the switch', async () => {
  const inv = await makeDraft();
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/invoices`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/companies/${alpha.id}/invoices`)).status).toBe(403);
  const clerk = await makeTech('cleo', w.deptA.id);
  await models.UserPermissionOverride.create({ userId: clerk.user.id, permissionKey: 'money.billing.manage', granted: true });
  invalidateAllPermissions();
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  await a().put(`${API}/users/${clerk.user.id}/company-access`).send({ allCompanies: false, companyIds: [other.id] }).expect(200);
  expect((await clerk.agent.get(`${API}/money/invoices/${inv.id}`)).status).toBe(404);
  expect((await clerk.agent.post(`${API}/money/invoices/${inv.id}/send`).send({})).status).toBe(404);
  expect(expectOk(await clerk.agent.get(`${API}/money/invoices`)).invoices).toEqual([]);
  expect(expectOk(await a().get(`${API}/companies/${alpha.id}/invoices`)).invoices).toHaveLength(1);
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await a().get(`${API}/money/invoices`)).status).toBe(404);
  expect((await a().get(`${API}/companies/${alpha.id}/invoices`)).status).toBe(404);
});

it('migration 116 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000116');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('Invoices');
  await upFrom('20260101000116');
  expect((await qi.describeTable('InvoiceLines')).taxCategoryId).toBeDefined();
});
