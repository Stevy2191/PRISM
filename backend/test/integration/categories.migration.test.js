const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000068-ticket-categories');

const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

const expectUp = async () => {
  expect(await tables()).toContain('TicketCategories');
  const cat = await qi().describeTable('TicketCategories');
  expect(Object.keys(cat)).toEqual(expect.arrayContaining(['id', 'parentId', 'name', 'sortOrder', 'active', 'requireChild', 'createdAt', 'updatedAt']));
  expect((await qi().describeTable('Tickets')).categoryId).toBeDefined();
  expect((await qi().describeTable('CustomFields')).categoryIds).toBeDefined();
  expect((await qi().describeTable('RecurringTickets')).categoryId).toBeDefined();
};

beforeEach(resetData);
afterAll(closeDb);

it('up creates the table and columns', expectUp);

it('Tickets.categoryId has exactly one index (the FK uses it)', async () => {
  const [rows] = await sequelize.query("SHOW INDEX FROM Tickets WHERE Column_name = 'categoryId'");
  expect(rows).toHaveLength(1);
});

it('grants tickets.categories.manage to System Administrator', async () => {
  const rows = await select(
    `SELECT p.\`key\` FROM Permissions p
       JOIN RolePermissions rp ON rp.permissionId = p.id AND rp.granted = 1
       JOIN Roles r ON r.id = rp.roleId
      WHERE r.name = 'System Administrator' AND p.\`key\` = 'tickets.categories.manage'`
  );
  expect(rows).toHaveLength(1);
});

it('seeds tickets.categoryRequired=false', async () => {
  const [row] = await select("SELECT value FROM SystemSettings WHERE `key` = 'tickets.categoryRequired'");
  expect(row.value).toBe('false');
});

it('down then up leaves the schema as the full chain does', async () => {
  await migration.down(qi(), Sequelize);
  expect(await tables()).not.toContain('TicketCategories');
  expect((await qi().describeTable('Tickets')).categoryId).toBeUndefined();
  expect((await qi().describeTable('CustomFields')).categoryIds).toBeUndefined();
  expect((await qi().describeTable('RecurringTickets')).categoryId).toBeUndefined();
  expect(await select("SELECT id FROM Permissions WHERE `key` = 'tickets.categories.manage'")).toHaveLength(0);
  expect(await select("SELECT value FROM SystemSettings WHERE `key` = 'tickets.categoryRequired'")).toHaveLength(0);
  await migration.up(qi(), Sequelize);
  await expectUp();
});
