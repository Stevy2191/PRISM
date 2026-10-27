const Sequelize = require('sequelize');
const { sequelize, closeDb, models, resetData } = require('./helpers');

const base = require('../../migrations/20260101000048-client-companies');
const portal = require('../../migrations/20260101000072-client-portal');

// down() drops Companies, which 072's portal-admin and KB-audience tables
// point at, so 072 is rolled back around it (and re-applied if down refuses).
const migration = {
  down: async (...args) => {
    await portal.down(...args);
    try { await base.down(...args); } catch (e) { await portal.up(...args); throw e; }
  },
  up: async (...args) => {
    await base.up(...args);
    await portal.up(...args);
  },
};

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });

// The previous suite's last test may have left a client company behind,
// which down() rightly refuses to drop.
beforeAll(resetData);

afterAll(async () => {
  // Leave the schema migrated and the probe rows gone for later suites.
  await sequelize.query("DELETE FROM Assets WHERE assetTag LIKE 'MIGPROBE-%'");
  await sequelize.query("DELETE FROM AssetCategories WHERE name = 'MigProbe'");
  await sequelize.query("DELETE FROM Companies WHERE isInternal = 0");
  // down() drops Companies and up() rebuilds it as of this migration, so
  // columns later migrations add to it must be put back for later suites.
  if (!(await qi().describeTable('Companies')).slaPolicyId) {
    await qi().addColumn('Companies', 'slaPolicyId', {
      type: Sequelize.INTEGER, allowNull: true, references: { model: 'SlaPolicies', key: 'id' }, onDelete: 'SET NULL',
    });
  }
  await closeDb();
});

describe('the client-companies migration', () => {
  it('backfills every record to one internal company and turns vendor text into vendor companies', async () => {
    await migration.down(qi(), Sequelize);
    expect((await qi().describeTable('Tickets')).companyId).toBeUndefined();

    // Today's shape: an asset category and three assets whose vendor is the
    // same company written three ways.
    await sequelize.query("INSERT INTO AssetCategories (name) VALUES ('MigProbe')");
    const [{ id: categoryId }] = await q("SELECT id FROM AssetCategories WHERE name = 'MigProbe'");
    for (const [tag, vendor] of [['MIGPROBE-1', 'Dell'], ['MIGPROBE-2', 'dell '], ['MIGPROBE-3', 'DELL']]) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query(
        'INSERT INTO Assets (assetTag, name, categoryId, vendorName, status, createdAt, updatedAt) VALUES (:tag, :tag, :categoryId, :vendor, \'active\', NOW(), NOW())',
        { replacements: { tag, categoryId, vendor } }
      );
    }

    await migration.up(qi(), Sequelize);

    const internal = await q('SELECT id, name, isInternal FROM Companies WHERE isInternal = 1');
    expect(internal).toHaveLength(1);
    for (const table of ['Departments', 'Contacts', 'Tickets', 'Projects', 'Assets', 'Licenses', 'Contracts']) {
      // eslint-disable-next-line no-await-in-loop
      const [{ n }] = await q(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE companyId IS NULL OR companyId <> :id`, { id: internal[0].id });
      expect(Number(n)).toBe(0);
    }
    const vendors = await q("SELECT id, name FROM Companies WHERE isVendor = 1 AND LOWER(name) = 'dell'");
    expect(vendors).toHaveLength(1);
    const linked = await q("SELECT COUNT(*) AS n FROM Assets WHERE assetTag LIKE 'MIGPROBE-%' AND vendorCompanyId = :id", { id: vendors[0].id });
    expect(Number(linked[0].n)).toBe(3);
    expect((await qi().describeTable('Users')).allCompanies).toBeDefined();
  });

  it('refuses to roll back once client data exists, rather than losing it', async () => {
    await models.Company.create({ name: 'Acme', isClient: true });
    await expect(migration.down(qi(), Sequelize)).rejects.toThrow(/client companies exist/i);
  });
});
