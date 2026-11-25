const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const { API, expectOk, makeWorld, makeTech } = require('./fixtures');
const stock = require('../../src/services/money/stock');
const ledger = require('../../src/services/money/ledger');
const { unit } = require('../../src/services/money/money');
const { downFrom, upFrom } = require('./moneyMigrations');
const migration = require('../../migrations/20260101000110-stock');

// Phase 3, step 2, task 2: shelf stock, bought by the box and used by the
// foot; never more than is on hand; a warning when it runs low.

let w;
let cable;
const a = () => w.admin.agent;
const bal = async () => Object.fromEntries((await ledger.balances()).map((b) => [b.code, b.balance]));
const fresh = () => models.CatalogProduct.findByPk(cable.id);

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const cabling = await models.TaxCategory.findOne({ where: { name: 'Cabling' } });
  cable = expectOk(await a().post(`${API}/money/products`).send({
    name: 'Cat6 cable', kind: 'product', unit: 'ft', cost: '180', purchaseUnit: 'box', usagePerPurchase: '1000', stocked: true, taxCategoryId: cabling.id,
  }), 201).product;
  await stock.stockIn(await fresh(), '1000', { unitCost: '0.18', userId: w.admin.user.id });
  expectOk(await a().patch(`${API}/money/stock/${cable.id}`).send({ lowStockAt: '200' }));
});
afterAll(closeDb);

it('shows what is on the shelf and what it is worth', async () => {
  const items = expectOk(await a().get(`${API}/money/stock`)).items;
  expect(items).toEqual([expect.objectContaining({
    productId: cable.id, name: 'Cat6 cable', unit: 'ft', onHand: '1000.0000', value: '180.00', lowStockAt: '200.0000', low: false,
  })]);
  expect((await bal())['1200']).toBe('0.00'); // stock arrives on the books with its bill, not on receipt
});

it('using stock takes it off the shelf and posts its cost', async () => {
  await stock.stockOut(await fresh(), '300', { userId: w.admin.user.id });
  expect(unit((await fresh()).onHand)).toBe('700.0000');
  const b = await bal();
  expect(b['5000']).toBe('54.00');
  expect(b['1200']).toBe('-54.00');
});

it('never uses more than is on hand; using the last of it warns purchasing', async () => {
  await expect(stock.stockOut(await fresh(), '1000.0001', { userId: w.admin.user.id })).rejects.toMatchObject({ status: 409, code: 'NOT_ENOUGH_STOCK' });
  expect(unit((await fresh()).onHand)).toBe('1000.0000');
  await stock.stockOut(await fresh(), '850', { userId: w.admin.user.id });
  const notes = await models.Notification.findAll({ where: { type: 'stock_low', userId: w.admin.user.id } });
  expect(notes).toHaveLength(1);
  expect(notes[0].message).toMatch(/Cat6 cable/);
  // Already low: no second warning for the next use.
  await stock.stockOut(await fresh(), '10', { userId: w.admin.user.id });
  expect(await models.Notification.count({ where: { type: 'stock_low' } })).toBe(1);
});

it('two uses at once never oversell', async () => {
  const p = await fresh();
  const results = await Promise.allSettled([
    stock.stockOut(p, '600', { userId: w.admin.user.id }),
    stock.stockOut(p, '600', { userId: w.admin.user.id }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(unit((await fresh()).onHand)).toBe('400.0000');
});

it('a count adjusts the shelf and posts the difference', async () => {
  expectOk(await a().post(`${API}/money/stock/${cable.id}/adjust`).send({ onHand: '950', note: 'Count, Dec 1' }));
  expect(unit((await fresh()).onHand)).toBe('950.0000');
  const b = await bal();
  expect(b['6900']).toBe('9.00');
  const moves = expectOk(await a().get(`${API}/money/stock/${cable.id}/movements`)).movements;
  expect(moves.map((m) => [m.reason, m.quantity])).toEqual([['adjust', '-50.0000'], ['receive', '1000.0000']]);
  expect((await a().post(`${API}/money/stock/${cable.id}/adjust`).send({ onHand: '-1' })).status).toBe(400);
});

it('a technician sees no stock', async () => {
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/stock`)).status).toBe(403);
});

it('migration 110 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000110');
  expect((await qi.describeTable('CatalogProducts')).onHand).toBeUndefined();
  await upFrom('20260101000110');
  expect((await qi.describeTable('CatalogProducts')).lowStockAt).toBeDefined();
});
