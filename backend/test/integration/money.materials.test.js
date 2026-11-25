const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech, setCompanyAccess,
} = require('./fixtures');
const stock = require('../../src/services/money/stock');
const { unit } = require('../../src/services/money/money');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const migration = require('../../migrations/20260101000111-materials-everywhere');

// Phase 3, step 2, task 3: materials on tickets as on projects — from the
// catalog or the shelf; technicians see quantities, never prices.

let w;
let ticket;
let cable;
let tech;
const a = () => w.admin.agent;
const url = (t = ticket) => `${API}/tickets/${t.id}/materials`;

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  ticket = await makeTicket(a(), { title: 'Bay PC down', contactId: w.contact.id });
  const cabling = await models.TaxCategory.findOne({ where: { name: 'Cabling' } });
  cable = expectOk(await a().post(`${API}/money/products`).send({
    name: 'Cat6 cable', kind: 'product', unit: 'ft', cost: '180', purchaseUnit: 'box', usagePerPurchase: '1000', stocked: true, taxCategoryId: cabling.id,
  }), 201).product;
  await stock.stockIn(await models.CatalogProduct.findByPk(cable.id), '1000', { userId: w.admin.user.id });
  tech = await makeTech('tess', w.deptA.id);
});
afterAll(closeDb);

it('a technician adds cable from the shelf; sees the quantity, not the price', async () => {
  const m = expectOk(await tech.agent.post(url()).send({ catalogProductId: cable.id, quantity: '300', fromStock: true }), 201).material;
  expect(m).toMatchObject({ itemName: 'Cat6 cable', ticketId: ticket.id, fromStock: true, billable: true, billingStatus: 'unbilled' });
  expect(unit(m.quantity)).toBe('300.0000');
  expect(m.unitCost).toBeUndefined();
  expect(m.unitPrice).toBeUndefined();
  expect(m.totalCost).toBeUndefined();
  expect(unit((await models.CatalogProduct.findByPk(cable.id)).onHand)).toBe('700.0000');
  const listed = expectOk(await tech.agent.get(url())).materials;
  expect(JSON.stringify(listed)).not.toMatch(/unitPrice|unitCost|totalCost/);

  // Someone who bills sees the money.
  const seen = expectOk(await a().get(url())).materials[0];
  expect(unit(seen.unitPrice)).toBe('0.1800');
  expect(unit(seen.unitCost)).toBe('0.1800');
  expect(seen.totalPrice).toBe('54.00');
});

it('more than is on the shelf is refused, and nothing is added', async () => {
  expect((await tech.agent.post(url()).send({ catalogProductId: cable.id, quantity: '1200', fromStock: true })).status).toBe(409);
  expect(await models.ProjectMaterial.count({ where: { ticketId: ticket.id } })).toBe(0);
});

it('a typed-in item with a price, by someone who bills; technicians can\'t set prices', async () => {
  const m = expectOk(await a().post(url()).send({ itemName: 'Patch panel', quantity: '1', unitPrice: '89.00', unitCost: '62.00' }), 201).material;
  expect(m.totalPrice).toBe('89.00');
  expect((await tech.agent.post(url()).send({ itemName: 'Patch panel', quantity: '1', unitPrice: '1.00' })).status).toBe(403);
  expect((await a().post(url()).send({ itemName: '', quantity: '1' })).status).toBe(400);
  expect((await a().post(url()).send({ itemName: 'X', quantity: '0' })).status).toBe(400);
});

it('edits and removals; removing a shelf item puts it back', async () => {
  const m = expectOk(await tech.agent.post(url()).send({ catalogProductId: cable.id, quantity: '300', fromStock: true }), 201).material;
  expectOk(await tech.agent.patch(`${url()}/${m.id}`).send({ notes: 'Bay 3' }));
  expectOk(await tech.agent.delete(`${url()}/${m.id}`));
  expect(unit((await models.CatalogProduct.findByPk(cable.id)).onHand)).toBe('1000.0000');
});

it('billed materials are locked on every path', async () => {
  const m = expectOk(await a().post(url()).send({ itemName: 'Patch panel', quantity: '1', unitPrice: '89.00' }), 201).material;
  await models.ProjectMaterial.update({ billingStatus: 'billed', invoiceLineId: 1 }, { where: { id: m.id }, allowBilled: true });
  for (const res of [
    await a().patch(`${url()}/${m.id}`).send({ notes: 'x' }),
    await a().delete(`${url()}/${m.id}`),
    await a().delete(`${API}/tickets/${ticket.id}`),
  ]) {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATERIAL_BILLED');
  }
  const other = await makeTicket(a(), { title: 'Keep', contactId: w.contact.id });
  expect((await a().post(`${API}/tickets/${other.id}/merge`).send({ sourceIds: [ticket.id] })).status).toBe(409);
});

it('merging moves unbilled materials; deleting a ticket deletes them', async () => {
  const m = expectOk(await a().post(url()).send({ itemName: 'Patch panel', quantity: '1', unitPrice: '89.00' }), 201).material;
  const other = await makeTicket(a(), { title: 'Keep', contactId: w.contact.id });
  expectOk(await a().post(`${API}/tickets/${other.id}/merge`).send({ sourceIds: [ticket.id] }));
  expect((await models.ProjectMaterial.findByPk(m.id)).ticketId).toBe(other.id);
  expectOk(await a().delete(`${API}/tickets/${other.id}`));
  expect(await models.ProjectMaterial.count({ where: { id: m.id } })).toBe(0);
});

it('another company\'s ticket can\'t be reached through its materials', async () => {
  const beta = await makeCompany(w.admin, { name: 'Beta' });
  const bob = await makeContact(w.admin, { companyId: beta.id, firstName: 'Bob', lastName: 'B' });
  const theirs = await makeTicket(a(), { title: 'Theirs', contactId: bob.id });
  const m = expectOk(await a().post(url(theirs)).send({ itemName: 'Mouse', quantity: '1', unitPrice: '20' }), 201).material;
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [w.contact.companyId] });
  expect([403, 404]).toContain((await tech.agent.get(url(theirs))).status);
  expect([403, 404]).toContain((await tech.agent.patch(`${url(theirs)}/${m.id}`).send({ notes: 'x' })).status);
  // Its id through this company's ticket: not found.
  expect((await a().patch(`${url()}/${m.id}`).send({ notes: 'x' })).status).toBe(404);
});

it('migration 111 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  expect((await qi.describeTable('ProjectMaterials')).ticketId).toBeUndefined();
  await migration.up(qi, Sequelize);
  expect((await qi.describeTable('ProjectMaterials')).billingStatus).toBeDefined();
});
