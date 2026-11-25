const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const { API, expectOk, makeWorld, makeTech } = require('./fixtures');
const { unitPrice, usageCost } = require('../../src/services/money/catalog');
const { moneyConfig } = require('../../src/services/money/config');
const migration = require('../../migrations/20260101000106-catalog-products');

// Phase 3, step 1, task 5: the products and services you sell or buy.

let w;
const a = () => w.admin.agent;
const add = async (body) => {
  const parts = await models.TaxCategory.findOne({ where: { name: 'Parts and equipment' } });
  return expectOk(await a().post(`${API}/money/products`).send({ taxCategoryId: parts.id, ...body }), 201).product;
};
const cable = { name: 'Cat6 cable', kind: 'product', unit: 'ft', cost: '180', purchaseUnit: 'box', usagePerPurchase: '1000', stocked: true };

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('cable bought by the box, sold by the foot at cost (no markup by default)', async () => {
  const p = await add(cable);
  expect(p).toMatchObject({ name: 'Cat6 cable', unit: 'ft', cost: '180.0000', usagePerPurchase: '1000.0000', stocked: true });
  const cfg = await moneyConfig();
  expect(usageCost(p)).toBe('0.1800');
  expect(unitPrice(p, cfg)).toBe('0.1800');
  expect(p.unitPrice).toBe('0.1800');
});

it('markup: the default, the product\'s own, or its own price', async () => {
  await a().put(`${API}/money/settings`).send({ defaultMarkupPercent: '15' }).expect(200);
  const cfg = await moneyConfig();
  const p = await add(cable);
  expect(unitPrice(p, cfg)).toBe('0.2070');
  const own = expectOk(await a().patch(`${API}/money/products/${p.id}`).send({ markupPercent: '10' })).product;
  expect(unitPrice(own, cfg)).toBe('0.1980');
  const priced = expectOk(await a().patch(`${API}/money/products/${p.id}`).send({ price: '0.25' })).product;
  expect(unitPrice(priced, cfg)).toBe('0.2500');
  const labor = await add({ name: 'Labor', kind: 'labor', unit: 'hour' });
  expect(unitPrice(labor, cfg)).toBe('0.0000');
});

it('validates, refuses duplicates, filters and searches', async () => {
  await add(cable);
  const anyCat = (await models.TaxCategory.findOne()).id;
  expect((await a().post(`${API}/money/products`).send({ ...cable, name: 'CAT6 CABLE', taxCategoryId: anyCat })).status).toBe(409);
  expect((await a().post(`${API}/money/products`).send({ name: 'Bad', kind: 'product', cost: '-1' })).status).toBe(400);
  expect((await a().post(`${API}/money/products`).send({ name: 'Bad', kind: 'gadget' })).status).toBe(400);
  expect((await a().post(`${API}/money/products`).send({ name: 'Bad', kind: 'product', usagePerPurchase: '0' })).status).toBe(400);
  expect((await a().post(`${API}/money/products`).send({ name: 'Bad', kind: 'product', taxCategoryId: 999999 })).status).toBe(400);
  const parts = await models.TaxCategory.findOne({ where: { name: 'Parts and equipment' } });
  await add({ name: 'Dell Latitude 5450', kind: 'product', cost: '1099', serialized: true, taxCategoryId: parts.id, sku: 'LAT5450' });
  await add({ name: 'Managed services, full user', kind: 'service', unit: 'user/month', price: '100' });
  const list = async (query) => expectOk(await a().get(`${API}/money/products`).query(query)).products.map((p) => p.name);
  expect(await list({ kind: 'service' })).toEqual(['Managed services, full user']);
  expect(await list({ search: 'lat5450' })).toEqual(['Dell Latitude 5450']);
  expect(await list({ search: 'cat6' })).toEqual(['Cat6 cable']);
  expect((await a().post(`${API}/money/products`).send({ name: 'Other', kind: 'product', sku: 'lat5450', taxCategoryId: anyCat })).status).toBe(409);
});

it('review fix: every product needs a tax category', async () => {
  const res = await a().post(`${API}/money/products`).send({ name: 'No tax', kind: 'product', cost: '1', taxCategoryId: null });
  expect(res.status).toBe(400);
  expect((await a().post(`${API}/money/products`).send({ name: 'Missing', kind: 'product', cost: '1' })).status).toBe(400);
  const p = await add(cable);
  expect((await a().patch(`${API}/money/products/${p.id}`).send({ taxCategoryId: null })).status).toBe(400);
});

it('a technician sees no products or costs', async () => {
  await add(cable);
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/products`)).status).toBe(403);
  expect((await tech.agent.post(`${API}/money/products`).send({ name: 'X', kind: 'fee' })).status).toBe(403);
});

it('migration 106 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  // 110's stock points at the products: undone first, redone after.
  const stockMig = require('../../migrations/20260101000110-stock');
  await stockMig.down(qi, Sequelize);
  await migration.down(qi, Sequelize);
  expect((await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName))).not.toContain('CatalogProducts');
  await migration.up(qi, Sequelize);
  await stockMig.up(qi, Sequelize);
  expect(await models.CatalogProduct.count()).toBe(0);
});
