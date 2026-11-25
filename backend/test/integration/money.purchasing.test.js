const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeProject, makeTech, setCompanyAccess,
} = require('./fixtures');
const { unit } = require('../../src/services/money/money');
const { downFrom, upFrom } = require('./moneyMigrations');
const migration = require('../../migrations/20260101000112-purchase-orders');

// Phase 3, step 2, task 4: purchase orders for a job, received in full or in
// part: job items become the job's materials, shelf items go on the shelf,
// and a serialized item (a laptop) becomes an asset in the customer's company.

let w;
let acme;
let supplier;
let project;
let cable;
let laptop;
const a = () => w.admin.agent;
const poUrl = (po) => `${API}/money/purchase-orders/${po.id}`;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme Auto' });
  supplier = await makeCompany(w.admin, { name: 'CDW', isClient: false, isVendor: true });
  await makeContact(w.admin, { companyId: acme.id, firstName: 'Ann', lastName: 'A' });
  const dept = expectOk(await a().post(`${API}/departments`).send({ name: 'Shop', companyId: acme.id }), 201).department;
  project = await makeProject(a(), { name: 'Northgate network', ownerDepartmentId: w.deptA.id, companyId: acme.id, forDepartmentId: dept.id });
  const cabling = await models.TaxCategory.findOne({ where: { name: 'Cabling' } });
  const parts = await models.TaxCategory.findOne({ where: { name: 'Parts and equipment' } });
  const computers = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  cable = expectOk(await a().post(`${API}/money/products`).send({
    name: 'Cat6 cable', kind: 'product', unit: 'ft', cost: '180', purchaseUnit: 'box', usagePerPurchase: '1000', stocked: true, taxCategoryId: cabling.id,
  }), 201).product;
  laptop = expectOk(await a().post(`${API}/money/products`).send({
    name: 'Dell Latitude 5450', kind: 'product', cost: '1099', serialized: true, taxCategoryId: parts.id, assetCategoryId: computers.id,
  }), 201).product;
});
afterAll(closeDb);

const makePo = async (extra = {}) => expectOk(await a().post(`${API}/money/purchase-orders`).send({
  vendorCompanyId: supplier.id,
  projectId: project.id,
  lines: [
    { catalogProductId: cable.id, quantity: '2', unitCost: '180', forStock: true },
    { catalogProductId: laptop.id, quantity: '1', unitCost: '1099' },
  ],
  ...extra,
}), 201).purchaseOrder;

it('a PO gets a number and goes draft → ordered', async () => {
  const po = await makePo();
  expect(po).toMatchObject({ status: 'draft', number: 'PO-00001', projectId: project.id });
  expect(po.lines).toHaveLength(2);
  expect(expectOk(await a().post(`${poUrl(po)}/order`).send({ orderedOn: '2026-12-01' })).purchaseOrder.status).toBe('ordered');
  expect((await makePo()).number).toBe('PO-00002');
});

it('receiving: the shelf for stock, the project for the laptop, which becomes Acme\'s asset', async () => {
  const po = await makePo();
  await a().post(`${poUrl(po)}/order`).send({}).expect(200);
  const [cableLine, laptopLine] = po.lines;

  let r = expectOk(await a().post(`${poUrl(po)}/receive`).send({ receivedOn: '2026-12-03', lines: [{ lineId: cableLine.id, quantity: '1' }] }));
  expect(r.purchaseOrder.status).toBe('partly_received');
  expect(unit((await models.CatalogProduct.findByPk(cable.id)).onHand)).toBe('1000.0000');

  r = expectOk(await a().post(`${poUrl(po)}/receive`).send({ receivedOn: '2026-12-03', lines: [{ lineId: laptopLine.id, quantity: '1', serials: ['7XK4Q93'] }] }));
  const asset = await models.Asset.findOne({ where: { serialNumber: '7XK4Q93' } });
  expect(asset).toMatchObject({ companyId: acme.id, purchaseDate: '2026-12-03', vendorCompanyId: supplier.id });
  expect(Number(asset.purchasePrice)).toBe(1099);
  const material = await models.ProjectMaterial.findOne({ where: { projectId: project.id, poLineId: laptopLine.id } });
  expect(material).toBeTruthy();
  expect(material.serialNumber).toEqual(['7XK4Q93']);
  expect(unit(material.quantity)).toBe('1.0000');

  r = expectOk(await a().post(`${poUrl(po)}/receive`).send({ lines: [{ lineId: cableLine.id, quantity: '1' }] }));
  expect(r.purchaseOrder.status).toBe('received');
  expect(unit((await models.CatalogProduct.findByPk(cable.id)).onHand)).toBe('2000.0000');
});

it('refuses receiving too much, twice past the order, a cancelled PO, missing serials, another PO\'s line', async () => {
  const po = await makePo();
  await a().post(`${poUrl(po)}/order`).send({}).expect(200);
  const [cableLine, laptopLine] = po.lines;
  expect((await a().post(`${poUrl(po)}/receive`).send({ lines: [{ lineId: cableLine.id, quantity: '3' }] })).status).toBe(400);
  expect((await a().post(`${poUrl(po)}/receive`).send({ lines: [{ lineId: laptopLine.id, quantity: '1' }] })).status).toBe(400);
  const other = await makePo();
  expect((await a().post(`${poUrl(po)}/receive`).send({ lines: [{ lineId: other.lines[0].id, quantity: '1' }] })).status).toBe(400);
  const draft = await makePo();
  expect((await a().post(`${poUrl(draft)}/receive`).send({ lines: [{ lineId: draft.lines[0].id, quantity: '1' }] })).status).toBe(409);
  await a().post(`${poUrl(po)}/cancel`).send({}).expect(200);
  expect((await a().post(`${poUrl(po)}/receive`).send({ lines: [{ lineId: cableLine.id, quantity: '1' }] })).status).toBe(409);
  expect(await models.Asset.count({ where: { companyId: acme.id } })).toBe(0);
});

it('a PO for stock has no job; a job out of reach is refused; technicians see none', async () => {
  const stockPo = expectOk(await a().post(`${API}/money/purchase-orders`).send({
    vendorCompanyId: supplier.id, lines: [{ catalogProductId: cable.id, quantity: '5', unitCost: '175', forStock: true }],
  }), 201).purchaseOrder;
  expect(stockPo.projectId).toBeNull();
  // A job line on a PO without a job has nowhere to go.
  expect((await a().post(`${API}/money/purchase-orders`).send({
    vendorCompanyId: supplier.id, lines: [{ catalogProductId: laptop.id, quantity: '1', unitCost: '1099' }],
  })).status).toBe(400);
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/purchase-orders`)).status).toBe(403);
  const buyer = await makeTech('bea', w.deptA.id);
  await models.UserPermissionOverride.create({ userId: buyer.user.id, permissionKey: 'money.purchasing.manage', granted: true });
  require('../../src/services/permissionService').invalidateAllPermissions();
  await setCompanyAccess(w.admin, buyer.user.id, { allCompanies: false, companyIds: [w.contact.companyId] });
  expect((await buyer.agent.post(`${API}/money/purchase-orders`).send({
    vendorCompanyId: supplier.id, projectId: project.id, lines: [{ catalogProductId: cable.id, quantity: '1', unitCost: '180', forStock: true }],
  })).status).toBe(400);
});

it('a project lists its purchase orders', async () => {
  await makePo();
  expect(expectOk(await a().get(`${API}/projects/${project.id}/purchase-orders`)).purchaseOrders).toHaveLength(1);
});

it('migration 112 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000112');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('PurchaseOrders');
  await upFrom('20260101000112');
  expect((await qi.describeTable('CatalogProducts')).assetCategoryId).toBeDefined();
});
