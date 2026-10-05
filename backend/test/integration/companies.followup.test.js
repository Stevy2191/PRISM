const Sequelize = require('sequelize');
const { resetData, closeDb, models } = require('./helpers');
const { makeWorld } = require('./fixtures');
const migration = require('../../migrations/20260101000049-client-companies-followup');

// Plan 2b task 2: the Companies nav module, and vendor text that plan 2a's
// migration couldn't link because SQL TRIM() keeps tabs and newlines.

const { Company, Asset, AssetCategory, ModuleVisibility, sequelize } = models;
const up = () => migration.up(sequelize.getQueryInterface(), Sequelize);

let category;
beforeEach(async () => {
  await resetData();
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await makeWorld();
  category = await AssetCategory.create({ name: 'Laptops' });
});
afterAll(async () => {
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

it('links vendor text that differs only by tabs, newlines or inner spaces', async () => {
  const dell = await Company.create({ name: 'Dell', isVendor: true });
  const a = await Asset.create({ assetTag: 'V-1', name: 'a', categoryId: category.id, vendorName: 'Dell\t' });
  const b = await Asset.create({ assetTag: 'V-2', name: 'b', categoryId: category.id, vendorName: '\nDELL ' });
  await up();
  expect((await Asset.findByPk(a.id)).vendorCompanyId).toBe(dell.id);
  expect((await Asset.findByPk(b.id)).vendorCompanyId).toBe(dell.id);
});

it('creates a vendor company for a spelling with none yet, once', async () => {
  await Asset.create({ assetTag: 'V-3', name: 'c', categoryId: category.id, vendorName: 'Big  Vendor\t' });
  await Asset.create({ assetTag: 'V-4', name: 'd', categoryId: category.id, vendorName: 'big vendor' });
  await up();
  const made = await Company.findAll({ where: { isVendor: true, name: 'Big Vendor' } });
  expect(made).toHaveLength(1);
  expect(await Asset.count({ where: { vendorCompanyId: made[0].id } })).toBe(2);
});

it('leaves blank vendor text and already-linked rows alone', async () => {
  const hp = await Company.create({ name: 'HP', isVendor: true });
  const linked = await Asset.create({ assetTag: 'V-5', name: 'e', categoryId: category.id, vendorName: 'Dell', vendorCompanyId: hp.id });
  const blank = await Asset.create({ assetTag: 'V-6', name: 'f', categoryId: category.id, vendorName: ' \t ' });
  await up();
  expect((await Asset.findByPk(linked.id)).vendorCompanyId).toBe(hp.id);
  expect((await Asset.findByPk(blank.id)).vendorCompanyId).toBeNull();
});

it('adds the Companies nav module, and running twice is harmless', async () => {
  await up();
  await up();
  const rows = await ModuleVisibility.findAll({ where: { moduleName: 'companies' } });
  expect(rows).toHaveLength(1);
  // A JSON column: the driver may hand back the parsed array or its text.
  const roles = rows[0].visibleToRoles;
  expect(typeof roles === 'string' ? JSON.parse(roles) : roles).toEqual(['admin', 'technician']);
});
