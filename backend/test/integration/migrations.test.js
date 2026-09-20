const { DataTypes } = require('sequelize');
const { sequelize, closeDb } = require('./helpers');

// Rolling a migration back has to work, or there is no way to back out a bad
// deploy. Sequelize's MariaDB dialect strips a `meta` property off raw query
// results with `delete data.meta`, under "use strict"; the mariadb driver
// defines that property without `configurable`, and deleting a
// non-configurable property throws in strict mode. Every removeColumn() in
// every migration's down() therefore failed with a message
// ("Cannot delete property 'meta' of [object Array]") that says nothing about
// the real cause.
//
// See src/config/mariadbDriver.js for the fix these tests cover.

const queryInterface = () => sequelize.getQueryInterface();

afterAll(closeDb);

describe('raw queries that carry driver metadata', () => {
  it('can be run through Sequelize without a strict-mode delete failing', async () => {
    const [rows] = await sequelize.query('SELECT 1 AS one');
    expect(rows[0].one).toBe(1);
  });
});

describe('queryInterface.removeColumn', () => {
  const TABLE = 'ZzRollbackProbe';

  beforeEach(async () => {
    await queryInterface().dropTable(TABLE).catch(() => {});
    await queryInterface().createTable(TABLE, {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      keeper: { type: DataTypes.STRING(32), allowNull: true },
      doomed: { type: DataTypes.STRING(32), allowNull: true },
    });
  });

  afterEach(async () => {
    await queryInterface().dropTable(TABLE).catch(() => {});
  });

  it('removes a column', async () => {
    await queryInterface().removeColumn(TABLE, 'doomed');
    const columns = await queryInterface().describeTable(TABLE);
    expect(columns.doomed).toBeUndefined();
    expect(columns.keeper).toBeDefined();
  });

  it('can be applied twice in a row (add, remove, add, remove)', async () => {
    await queryInterface().removeColumn(TABLE, 'doomed');
    await queryInterface().addColumn(TABLE, 'doomed', { type: DataTypes.STRING(32), allowNull: true });
    await queryInterface().removeColumn(TABLE, 'doomed');
    const columns = await queryInterface().describeTable(TABLE);
    expect(columns.doomed).toBeUndefined();
  });
});

describe('the SSO migration rolls back and re-applies', () => {
  // The most recent migration, exercised end to end: down() drops four tables
  // and a column (the removeColumn that used to throw), up() puts them back.
  const migration = require('../../migrations/20260101000047-sso');
  const Sequelize = require('sequelize');

  it('survives a full down/up cycle', async () => {
    const qi = queryInterface();

    const tableNames = async () => (await qi.showAllTables())
      .map((t) => (typeof t === 'string' ? t : t.tableName));

    await migration.down(qi);
    expect((await tableNames()).filter((t) => t.startsWith('Sso'))).toHaveLength(0);
    expect((await qi.describeTable('Users')).isBreakGlass).toBeUndefined();

    await migration.up(qi, Sequelize);
    expect((await tableNames()).filter((t) => t.startsWith('Sso')).sort()).toEqual([
      'SsoAuthRequests', 'SsoGroupMappings', 'SsoIdentities', 'SsoProviders',
    ]);
    expect((await qi.describeTable('Users')).isBreakGlass).toBeDefined();
  });
});
