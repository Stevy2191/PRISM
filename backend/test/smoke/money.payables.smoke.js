const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Phase 3, step 2, task 7: the Money screens. Eric (Hale Communication)
// bills for HR's network drop; a laptop and a box of cable are ordered and
// received; a technician uses 300 ft of cable; fuel is expensed.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let smoke;
let w;
let page;
let ticket;
let hale;
let cable;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  hale = await makeCompany(w.admin, { name: 'Hale Communication', isClient: false, isVendor: true });
  await makeCompany(w.admin, { name: 'CDW', isClient: false, isVendor: true });
  const hr = await makeContact(w.admin, { companyId: w.contact.companyId, firstName: 'Hana', lastName: 'Ruiz' });
  ticket = await makeTicket(w.admin.agent, { title: 'New network drop for HR', contactId: hr.id });
  const cabling = await models.TaxCategory.findOne({ where: { name: 'Cabling' } });
  const parts = await models.TaxCategory.findOne({ where: { name: 'Parts and equipment' } });
  cable = expectOk(await w.admin.agent.post(`${API}/money/products`).send({
    name: 'Cat6 cable', kind: 'product', unit: 'ft', cost: '180', purchaseUnit: 'box', usagePerPurchase: '1000', stocked: true, taxCategoryId: cabling.id,
  }), 201).product;
  expectOk(await w.admin.agent.post(`${API}/money/products`).send({
    name: 'Dell Latitude 5450', kind: 'product', cost: '1099', serialized: true, taxCategoryId: parts.id,
  }), 201);
  await makeTech('tess', w.deptA.id);
  page = await smoke.pageAs('admin');
  page.on('dialog', (d) => d.accept());
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('Hale\'s bill goes on the HR ticket with its PDF, is entered with the Incode number, and paid', async () => {
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByRole('button', { name: 'Add a bill' }).click();
  const form = page.getByRole('form', { name: 'Bill' });
  await form.getByLabel('Vendor', { exact: true }).selectOption({ label: 'Hale Communication' });
  await form.getByLabel('Their bill number').fill('H-1042');
  await form.getByLabel('Bill date').fill('2026-12-01');
  const line = form.getByRole('group', { name: 'Line 1' });
  await line.getByLabel('Description').fill('Network drop, HR office');
  await line.getByLabel('Amount ($)').fill('1250');
  await form.getByLabel('The vendor\'s bill (PDF or photo)').setInputFiles({ name: 'H-1042.pdf', mimeType: 'application/pdf', buffer: PDF });
  await form.getByRole('button', { name: 'Save bill' }).click();

  const list = page.getByTestId('ticket-bills-list');
  await list.getByText('bill H-1042').click();
  await list.getByText('H-1042.pdf').waitFor();
  await list.getByLabel('Reference in your system (e.g. Incode)').fill('INC-5521');
  await list.getByRole('button', { name: 'Mark entered' }).click();
  await list.getByText('entered', { exact: true }).waitFor();
  await list.getByLabel('Paid on').fill('2026-12-15');
  await list.getByLabel('Check or payment number').fill('3301');
  await list.getByRole('button', { name: 'Mark paid' }).click();
  await list.getByText('paid', { exact: true }).waitFor();
  const bill = await models.Bill.findOne({ where: { billNumber: 'H-1042' } });
  expect(bill).toMatchObject({ status: 'paid', externalRef: 'INC-5521', paidOn: '2026-12-15', vendorCompanyId: hale.id });
  expect(bill.fileName).toBe('H-1042.pdf');

  await page.goto('/money?tab=reports');
  await page.getByLabel('Year').selectOption('2026');
  const report = page.getByTestId('paid-by-vendor');
  await report.getByText('Hale Communication').waitFor();
  await report.getByText('$1,250.00').first().waitFor();
});

it('a PO for a laptop and cable: received with a serial, the laptop becomes an asset, the cable is on the shelf', async () => {
  await page.goto('/money?tab=purchase-orders');
  await page.getByRole('button', { name: 'New purchase order' }).click();
  const form = page.getByRole('form', { name: 'Purchase order' });
  await form.getByLabel('Vendor', { exact: true }).selectOption({ label: 'CDW' });
  await form.getByLabel('For', { exact: true }).selectOption('ticket');
  await form.getByLabel('Ticket number').fill(ticket.number);
  await form.getByRole('group', { name: 'Item 1' }).getByLabel('Product', { exact: true }).selectOption({ label: 'Dell Latitude 5450' });
  await form.getByRole('button', { name: 'Add an item' }).click();
  const second = form.getByRole('group', { name: 'Item 2' });
  await second.getByLabel('Product', { exact: true }).selectOption({ label: 'Cat6 cable' });
  await second.getByLabel('For the shelf').check();
  await form.getByRole('button', { name: 'Save purchase order' }).click();

  const table = page.getByTestId('purchase-orders');
  await table.getByRole('button', { name: 'Mark ordered' }).click();
  await table.getByText('ordered', { exact: true }).waitFor();
  await table.getByRole('button', { name: 'Receive items' }).click();
  await table.getByLabel('Dell Latitude 5450 serial numbers').fill('7XK4Q93');
  await table.getByRole('button', { name: 'Receive', exact: true }).click();
  await table.getByText('received', { exact: true }).waitFor();

  const asset = await models.Asset.findOne({ where: { serialNumber: '7XK4Q93' } });
  expect(asset.companyId).toBe(w.contact.companyId);
  await page.goto('/money?tab=stock');
  await page.getByTestId('stock').getByText('1000 ft').waitFor();
});

it('a technician adds 300 ft of cable to the ticket and sees no price; sees no Money', async () => {
  const tech = await smoke.pageAs('tess');
  await tech.goto(`/tickets/${ticket.id}`);
  await tech.getByRole('button', { name: 'Materials', exact: true }).click();
  await tech.getByRole('button', { name: 'Add material' }).click();
  const form = tech.getByRole('form', { name: 'Material' });
  await form.getByLabel('Product', { exact: true }).selectOption({ label: 'Cat6 cable (1000 ft on the shelf)' });
  await form.getByLabel('Quantity (ft)').fill('300');
  expect(await form.getByLabel('Taken from the shelf').isChecked()).toBe(true);
  await form.getByRole('button', { name: 'Add' }).click();
  const materials = tech.getByTestId('materials');
  await materials.getByText('from the shelf').first().waitFor();
  expect(await materials.getByText('Price').count()).toBe(0);
  expect(await materials.getByText(/\$/).count()).toBe(0);
  expect((await models.CatalogProduct.findByPk(cable.id)).onHand).toBe(700);
  expect(await tech.locator('a[href="/money"]').count()).toBe(0);
});

it('fuel is expensed with a receipt photo', async () => {
  await page.goto('/money?tab=expenses');
  await page.getByRole('button', { name: 'Record an expense' }).click();
  const form = page.getByRole('form', { name: 'Expense' });
  await form.getByLabel('Date').fill('2026-12-03');
  await form.getByLabel('Amount ($)').fill('62.40');
  await form.getByLabel('What for').fill('Fuel, trip to Acme');
  await form.getByLabel('Receipt (PDF or photo)').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: 'Save expense' }).click();
  const table = page.getByTestId('expenses');
  await table.getByText('Fuel, trip to Acme').waitFor();
  await table.getByText('receipt.png').waitFor();
  await table.getByText('$62.40').waitFor();
});
