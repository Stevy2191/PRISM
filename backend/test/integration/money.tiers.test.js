const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTech,
} = require('./fixtures');
const { effectiveTier, tierCounts } = require('../../src/services/money/tiers');
const { downFrom, upFrom } = require('./moneyMigrations');
const migration = require('../../migrations/20260101000108-support-tiers');

// Phase 3, step 1, task 7: support tiers (Full, Light, Not covered) on
// contacts, from their department and from Microsoft 365 frontline licenses.

let w;
let acme;
let office;
let shop;
const a = () => w.admin.agent;
const dept = async (name, defaultSupportTier) => expectOk(await a().post(`${API}/departments`).send({ name, companyId: acme.id, ...(defaultSupportTier ? { defaultSupportTier } : {}) }), 201).department;
const person = (fields) => makeContact(w.admin, { companyId: acme.id, lastName: 'X', ...fields });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme Auto' });
  office = await dept('Office');
  shop = await dept('Shop', 'light');
});
afterAll(closeDb);

it('works out the tier: manual, then frontline license, then department, then Full', () => {
  expect(effectiveTier({ supportTier: null, m365Frontline: false }, { defaultSupportTier: 'light' })).toBe('light');
  expect(effectiveTier({ supportTier: 'full', m365Frontline: true }, { defaultSupportTier: 'light' })).toBe('full');
  expect(effectiveTier({ supportTier: null, m365Frontline: true }, { defaultSupportTier: 'full' })).toBe('light');
  expect(effectiveTier({ supportTier: 'none', m365Frontline: false }, null)).toBe('none');
  expect(effectiveTier({ supportTier: null, m365Frontline: false }, null)).toBe('full');
});

it('departments default to Full; the shop is Light', async () => {
  expect(office.defaultSupportTier).toBe('full');
  expect(shop.defaultSupportTier).toBe('light');
  expect((await a().post(`${API}/departments`).send({ name: 'Odd', companyId: acme.id, defaultSupportTier: 'gold' })).status).toBe(400);
});

it('counts a company\'s people by tier, leaving out inactive people and placeholders', async () => {
  await person({ firstName: 'Olga', departmentId: office.id });
  await person({ firstName: 'Omar', departmentId: office.id });
  await person({ firstName: 'Sam', departmentId: shop.id });
  const sid = await person({ firstName: 'Sid', departmentId: shop.id });
  await person({ firstName: 'Nobody' });
  const gone = await person({ firstName: 'Gone', departmentId: office.id });
  await models.Contact.update({ status: 'inactive' }, { where: { id: gone.id } });
  await models.Contact.create({ firstName: 'Front', lastName: 'Desk', displayName: 'Front desk PC', companyId: acme.id, isPlaceholder: true });
  expectOk(await a().patch(`${API}/contacts/${sid.id}`).send({ supportTier: 'none' }));
  expect(await tierCounts(acme.id)).toEqual({ full: 3, light: 1, none: 1 });
});

it('the contact shows its tier and why; only money.billing.manage sets it', async () => {
  const sam = await person({ firstName: 'Sam', departmentId: shop.id });
  let shown = expectOk(await a().get(`${API}/contacts/${sam.id}`)).contact;
  expect(shown).toMatchObject({ supportTier: null, effectiveSupportTier: 'light' });
  shown = expectOk(await a().patch(`${API}/contacts/${sam.id}`).send({ supportTier: 'full' })).contact;
  expect(shown).toMatchObject({ supportTier: 'full', effectiveSupportTier: 'full' });
  expect((await a().patch(`${API}/contacts/${sam.id}`).send({ supportTier: 'gold' })).status).toBe(400);
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.patch(`${API}/contacts/${sam.id}`).send({ supportTier: 'none' })).status).toBe(403);
  // The rest of a contact stays editable as before.
  const plain = await tech.agent.patch(`${API}/contacts/${sam.id}`).send({ jobTitle: 'Mechanic' });
  expect([200, 403]).toContain(plain.status);
  expect((await models.Contact.findByPk(sam.id)).supportTier).toBe('full');
});

it('migration 108 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000108');
  expect((await qi.describeTable('Contacts')).supportTier).toBeUndefined();
  expect((await qi.describeTable('Departments')).defaultSupportTier).toBeUndefined();
  await upFrom('20260101000108');
  expect((await qi.describeTable('Contacts')).m365Frontline).toBeDefined();
});
