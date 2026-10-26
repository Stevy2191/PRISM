const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize, createUser, ROLE } = require('./helpers');
const migration = require('../../migrations/20260101000071-workload');

const qi = () => sequelize.getQueryInterface();
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const KEYS = ['workload.defaultTicketMinutes', 'workload.defaultWorkHours'];

beforeEach(resetData);
afterAll(closeDb);

it('up adds the columns, the settings and the permission', async () => {
  expect((await qi().describeTable('Users')).workHours).toBeDefined();
  expect((await qi().describeTable('Tickets')).plannedDate).toBeDefined();
  const settings = await select("SELECT `key`, value FROM SystemSettings WHERE `key` LIKE 'workload.%' ORDER BY `key`");
  expect(settings.map((s) => s.key)).toEqual(KEYS);
  expect(JSON.parse(settings[1].value)).toEqual({
    1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0, 7: 0,
  });
  expect(settings[0].value).toBe('60');
  const perm = await select("SELECT category, label, description FROM Permissions WHERE `key` = 'workload.view'");
  expect(perm).toEqual([{ category: 'workload', label: 'View workload', description: 'Open the Workload screen' }]);
  // Granted to the roles that already see every ticket or every project, and to no one else.
  const granted = await select(
    `SELECT DISTINCT r.name FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` = 'workload.view' AND rp.granted = 1`
  );
  const wide = await select(
    `SELECT DISTINCT r.name FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` IN ('tickets.view_all', 'projects.view_all') AND rp.granted = 1`
  );
  expect(granted.map((g) => g.name).sort()).toEqual(wide.map((g) => g.name).sort());
  expect(granted.length).toBeGreaterThan(0);
});

it('round trip', async () => {
  const { user } = await createUser({ username: 'wl-user', roleName: ROLE.ADMIN });
  await sequelize.query(
    "INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt) VALUES (?, 'workload.view', 1, NOW())",
    { replacements: [user.id] }
  );
  await migration.down(qi(), Sequelize);
  try {
    expect((await qi().describeTable('Users')).workHours).toBeUndefined();
    expect((await qi().describeTable('Tickets')).plannedDate).toBeUndefined();
    expect(await select("SELECT 1 FROM SystemSettings WHERE `key` LIKE 'workload.%'")).toHaveLength(0);
    expect(await select("SELECT id FROM Permissions WHERE `key` = 'workload.view'")).toHaveLength(0);
    expect(await select("SELECT 1 FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId WHERE p.`key` = 'workload.view'")).toHaveLength(0);
    expect(await select("SELECT 1 FROM UserPermissionOverrides WHERE permissionKey = 'workload.view'")).toHaveLength(0);
  } finally {
    await migration.up(qi(), Sequelize);
  }
  await migration.up(qi(), Sequelize); // idempotent
  expect((await qi().describeTable('Users')).workHours).toBeDefined();
  expect(await select("SELECT 1 FROM SystemSettings WHERE `key` LIKE 'workload.%'")).toHaveLength(2);
  expect(await select("SELECT id FROM Permissions WHERE `key` = 'workload.view'")).toHaveLength(1);
});
