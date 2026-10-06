const Sequelize = require('sequelize');
const { sequelize, closeDb, resetData } = require('./helpers');

const migration = require('../../migrations/20260101000051-edit-tier');

// Plan 3b-2's migration: the seeded System Technician keeps today's reach
// under the edit tier (spec decision Q26), and projects.log_time retires.

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
const keysOf = async (role) => (await q(`SELECT p.\`key\` AS k FROM Roles r JOIN RolePermissions rp ON rp.roleId = r.id AND rp.granted = 1
  JOIN Permissions p ON p.id = rp.permissionId WHERE r.name = :role ORDER BY p.\`key\``, { role })).map((r) => r.k);

beforeAll(resetData);
afterAll(async () => {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM Permissions WHERE `key` = 'projects.log_time'");
  if (Number(n) > 0) await migration.up(qi(), Sequelize);
  await closeDb();
});

it('grants System Technician the edit_all tiers and retires projects.log_time', async () => {
  const tech = await keysOf('System Technician');
  expect(tech).toEqual(expect.arrayContaining(['projects.edit_all', 'tickets.edit_all', 'time.log']));
  expect(await q("SELECT id FROM Permissions WHERE `key` = 'projects.log_time'")).toEqual([]);
});

it('round-trips: down() restores projects.log_time to time.log holders and takes the grants back', async () => {
  await migration.down(qi(), Sequelize);
  expect(await keysOf('System Technician')).not.toContain('tickets.edit_all');
  for (const role of ['System Technician', 'Department Staff', 'Department Manager']) {
    // eslint-disable-next-line no-await-in-loop
    expect(await keysOf(role)).toContain('projects.log_time');
  }
  await migration.up(qi(), Sequelize);
  expect(await keysOf('System Technician')).toContain('tickets.edit_all');
});
