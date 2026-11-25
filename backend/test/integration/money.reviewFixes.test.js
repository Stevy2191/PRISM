const fs = require('fs');
const path = require('path');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech, makeProject,
} = require('./fixtures');
const stock = require('../../src/services/money/stock');
const { unit } = require('../../src/services/money/money');
const { UPLOAD_ROOT } = require('../../src/middleware/upload');
const { downFrom, upFrom } = require('./moneyMigrations');

// Phase 3, step 2: fixes from the step's review.

let w;
let cable;
let tech;
let project;
const a = () => w.admin.agent;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const cabling = await models.TaxCategory.findOne({ where: { name: 'Cabling' } });
  // $47.50 a box of 1,000 ft: $0.0475 a foot.
  cable = expectOk(await a().post(`${API}/money/products`).send({
    name: 'Cat6 cable', kind: 'product', unit: 'ft', cost: '47.50', purchaseUnit: 'box', usagePerPurchase: '1000', stocked: true, taxCategoryId: cabling.id,
  }), 201).product;
  await stock.stockIn(await models.CatalogProduct.findByPk(cable.id), '1000', { userId: w.admin.user.id });
  tech = await makeTech('tess', w.deptA.id);
  project = await makeProject(a(), { name: 'Office move', ownerDepartmentId: w.deptA.id });
  await models.ProjectMember.create({ projectId: project.id, userId: tech.user.id, role: 'member' }).catch(() => {});
});
afterAll(closeDb);

it('a project\'s materials show no prices or costs to someone without a money permission', async () => {
  expectOk(await a().post(`${API}/projects/${project.id}/materials`).send({ catalogProductId: cable.id, quantity: '300', fromStock: true }), 201);
  const res = await tech.agent.get(`${API}/projects/${project.id}/materials`);
  if (res.status === 200) {
    expect(res.body.materials).toHaveLength(1);
    expect(JSON.stringify(res.body.materials)).not.toMatch(/unitPrice|unitCost|totalCost/);
    expect(res.body.totalAmount).toBe(0); // only hand-typed costs count for them
  } else expect([403, 404]).toContain(res.status);
  const mine = expectOk(await a().get(`${API}/projects/${project.id}/materials`));
  expect(mine.materials[0].unitPrice).toBeDefined();
});

it('a project\'s shelf item keeps its quantity and cost; fractions are fine elsewhere', async () => {
  const m = expectOk(await a().post(`${API}/projects/${project.id}/materials`).send({ catalogProductId: cable.id, quantity: '300', fromStock: true }), 201).material;
  expect((await a().patch(`${API}/projects/${project.id}/materials/${m.id}`).send({ quantity: 1000 })).status).toBe(400);
  expect((await a().patch(`${API}/projects/${project.id}/materials/${m.id}`).send({ unitCost: 1 })).status).toBe(400);
  const typed = expectOk(await a().post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Velcro', quantity: 1, unitCost: 3 }), 201).material;
  expectOk(await a().patch(`${API}/projects/${project.id}/materials/${typed.id}`).send({ quantity: '2.5' }));
  expect(unit((await models.ProjectMaterial.findByPk(typed.id)).quantity)).toBe('2.5000');
});

it('a material\'s unit cost keeps 4 decimals and its total matches the books after a note', async () => {
  const t = await makeTicket(a(), { title: 'Drop', contactId: w.contact.id });
  const m = expectOk(await a().post(`${API}/tickets/${t.id}/materials`).send({ catalogProductId: cable.id, quantity: '300', fromStock: true }), 201).material;
  let row = await models.ProjectMaterial.findByPk(m.id);
  expect(unit(row.unitCost)).toBe('0.0475');
  expect(Number(row.totalCost)).toBe(14.25);
  expectOk(await a().patch(`${API}/tickets/${t.id}/materials/${m.id}`).send({ notes: 'HR closet' }));
  row = await models.ProjectMaterial.findByPk(m.id);
  expect(Number(row.totalCost)).toBe(14.25);
});

it('a ticket material can\'t be pointed at a PO line or another job\'s task', async () => {
  const t = await makeTicket(a(), { title: 'Drop', contactId: w.contact.id });
  const task = expectOk(await a().post(`${API}/projects/${project.id}/tasks`).send({ title: 'Elsewhere' }), 201).task;
  const m = expectOk(await a().post(`${API}/tickets/${t.id}/materials`).send({ itemName: 'Plate', quantity: '1', poLineId: 999, taskId: task.id }), 201).material;
  const row = await models.ProjectMaterial.findByPk(m.id);
  expect(row.poLineId).toBeNull();
  expect(row.taskId).toBeNull();
});

it('merging a 1099 vendor keeps it a 1099 vendor', async () => {
  const hale = await makeCompany(w.admin, { name: 'Hale Communication', isClient: false, isVendor: true });
  await a().patch(`${API}/companies/${hale.id}`).send({ is1099: true }).expect(200);
  const dup = await makeCompany(w.admin, { name: 'Hale Comms', isClient: false, isVendor: true });
  expectOk(await a().post(`${API}/companies/${hale.id}/merge`).send({ intoCompanyId: dup.id }));
  expect((await models.Company.findByPk(dup.id)).is1099).toBe(true);
});

it('receiving a job PO whose ticket is gone is refused, not a crash', async () => {
  const vendor = await makeCompany(w.admin, { name: 'CDW', isClient: false, isVendor: true });
  const t = await makeTicket(a(), { title: 'Gone', contactId: w.contact.id });
  const po = expectOk(await a().post(`${API}/money/purchase-orders`).send({
    vendorCompanyId: vendor.id, ticketId: t.id, lines: [{ description: 'Plate', quantity: '1', unitCost: '3' }],
  }), 201).purchaseOrder;
  await a().post(`${API}/money/purchase-orders/${po.id}/order`).send({}).expect(200);
  expectOk(await a().delete(`${API}/tickets/${t.id}`));
  expect((await a().post(`${API}/money/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: po.lines[0].id, quantity: '1' }] })).status).toBe(409);
});

it('an upload to a bill or expense that doesn\'t exist leaves no file behind', async () => {
  const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
  expect((await a().post(`${API}/money/bills/987654/file`).attach('file', PDF, 'x.pdf')).status).toBe(404);
  expect((await a().post(`${API}/money/expenses/987654/receipt`).attach('file', PDF, 'x.pdf')).status).toBe(404);
  expect(fs.existsSync(path.join(UPLOAD_ROOT, 'bills', '987654'))).toBe(false);
  expect(fs.existsSync(path.join(UPLOAD_ROOT, 'expenses', '987654'))).toBe(false);
});

it('a bill, expense or PO line names its ticket by number (WC-T0042), not only by id', async () => {
  const t = await makeTicket(a(), { title: 'Drop', contactId: w.contact.id });
  const vendor = await makeCompany(w.admin, { name: 'Hale', isClient: false, isVendor: true });
  const bill = expectOk(await a().post(`${API}/money/bills`).send({
    vendorCompanyId: vendor.id, billNumber: 'H-1', billDate: '2026-12-01', total: '5.00', lines: [{ kind: 'contractor', description: 'x', amount: '5.00', ticketId: t.number }],
  }), 201).bill;
  expect(bill.lines[0].ticketId).toBe(t.id);
  const e = expectOk(await a().post(`${API}/money/expenses`).send({
    spentOn: '2026-12-01', account: '6200', description: 'Fuel', amount: '9.00', paymentMethod: 'card', ticketId: t.number,
  }), 201).expense;
  expect(e.ticketId).toBe(t.id);
});

it('migration 114 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000114');
  expect((await qi.describeTable('ProjectMaterials')).unitCost.type).toMatch(/DECIMAL\(10,2\)/i);
  await upFrom('20260101000114');
  expect((await qi.describeTable('ProjectMaterials')).unitCost.type).toMatch(/DECIMAL\(12,4\)/i);
});
