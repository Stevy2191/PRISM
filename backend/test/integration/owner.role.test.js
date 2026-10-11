const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize, ROLE } = require('./helpers');
const { API, expectOk, makeWorld, makeUser } = require('./fixtures');
const { resolveUserPermissions, invalidateAllPermissions } = require('../../src/services/permissionService');
const migration = require('../../migrations/20260101000055-owner-role');

// The Owner (user decision 2026-10-11): the top role, every permission, every
// company; on upgrade the oldest active administrator becomes the Owner.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

const ownerRole = () => models.Role.findOne({ where: { name: 'Owner', isSystemRole: true } });

it('an Owner holds every permission, even against a deny override, and reaches every company', async () => {
  expect(expectOk(await w.admin.agent.get(`${API}/auth/me`)).user.isOwner).toBe(true);
  await models.UserPermissionOverride.create({ userId: w.admin.user.id, permissionKey: 'tickets.view_all', granted: false });
  invalidateAllPermissions();
  const perms = await resolveUserPermissions(w.admin.user.id);
  expect(Object.entries(perms).filter(([, v]) => !v)).toEqual([]);
  expect(expectOk(await w.admin.agent.get(`${API}/users/${w.admin.user.id}/company-access`)).access.unfenceable).toBe(true);
});

it('a System Administrator is not an Owner', async () => {
  const sa = await makeUser('sa', ROLE.ADMIN, w.deptA.id);
  expect(expectOk(await sa.agent.get(`${API}/auth/me`)).user.isOwner).toBe(false);
});

it('the migration makes the oldest active administrator the Owner (an inactive one is skipped), and round-trips', async () => {
  const qi = sequelize.getQueryInterface();
  const next = await makeUser('nextadmin', ROLE.ADMIN, w.deptA.id);
  await migration.down(qi, Sequelize);
  expect(await ownerRole()).toBeNull();
  await models.User.update({ isActive: false }, { where: { id: w.admin.user.id } }); // the oldest, but inactive
  await migration.up(qi, Sequelize);
  const role = await ownerRole();
  expect((await models.UserRole.findAll({ where: { roleId: role.id } })).map((r) => r.userId)).toEqual([next.user.id]);
  // Running it again changes nothing: there is already an Owner.
  await migration.up(qi, Sequelize);
  expect(await models.UserRole.count({ where: { roleId: role.id } })).toBe(1);
});
