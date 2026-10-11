const Sequelize = require('sequelize');
const { sequelize, closeDb, resetData } = require('./helpers');
const { makeWorld } = require('./fixtures');

const migration = require('../../migrations/20260101000052-moderate-permissions');

// Moderation moves to its own permissions (user decision 2026-10-11): every
// role and user who could moderate before plan 3b-2 keeps it; the System
// Technician, whose edit_all plan 3b-2 granted, doesn't gain it.

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
const holders = async (key) => (await q(`SELECT r.name FROM Roles r JOIN RolePermissions rp ON rp.roleId = r.id AND rp.granted = 1
  JOIN Permissions p ON p.id = rp.permissionId WHERE p.\`key\` = :key ORDER BY r.name`, { key })).map((r) => r.name);

beforeAll(resetData);
afterAll(async () => {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM Permissions WHERE `key` = 'tickets.moderate'");
  if (Number(n) === 0) await migration.up(qi(), Sequelize);
  await closeDb();
});

it('grants moderation to the roles that could moderate before, not to System Technician', async () => {
  for (const key of ['tickets.moderate', 'projects.moderate']) {
    // eslint-disable-next-line no-await-in-loop
    expect(await holders(key)).toEqual(['Department Manager', 'Owner', 'System Administrator']); // the Owner holds everything
  }
});

it('carries per-user edit-tier grants over as moderate grants, and round-trips', async () => {
  const user = (await makeWorld()).admin.user;
  await migration.down(qi(), Sequelize);
  expect(await q("SELECT id FROM Permissions WHERE `key` IN ('tickets.moderate', 'projects.moderate')")).toEqual([]);
  await sequelize.query(`INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt)
    VALUES (:u, 'tickets.edit_department', 1, NOW())`, { replacements: { u: user.id } });
  await migration.up(qi(), Sequelize);
  expect((await q("SELECT permissionKey, granted FROM UserPermissionOverrides WHERE userId = :u AND permissionKey LIKE '%.moderate'", { u: user.id }))
    .map((r) => [r.permissionKey, Number(r.granted)])).toEqual([['tickets.moderate', 1]]);
  await sequelize.query("DELETE FROM UserPermissionOverrides WHERE userId = :u AND permissionKey IN ('tickets.edit_department', 'tickets.moderate')", { replacements: { u: user.id } });
});
