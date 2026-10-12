const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize, createUserAndLogin, ROLE,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff,
} = require('./fixtures');
const migration = require('../../migrations/20260101000056-settle-account-roles');

// An account's main role (what the Users page shows) and the legacy admin
// marker follow the roles it holds (found 2026-10-11: removing an Owner's
// System Administrator role left them with no main role).

const {
  User, UserRole, Role, Department, UserPermissionOverride, UserCompanyAccess,
} = models;

let w;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const reload = (id) => User.findByPk(id);
const roleIdsOf = async (userId) => (await UserRole.findAll({ where: { userId }, order: [['roleId', 'ASC']] })).map((r) => r.roleId);
// Another Owner: nobody changes their own roles.
const makeSecondOwner = () => createUserAndLogin({ username: 'owner2', roleName: ROLE.OWNER, legacyRole: 'admin' });

beforeEach(async () => {
  await resetData();
  await Role.destroy({ where: { name: 'Temp' } }); // roles are not reset between tests
  w = await makeWorld();
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
});
afterEach(() => Role.destroy({ where: { name: 'Temp' } }));
afterAll(closeDb);

describe('removing a main role', () => {
  it('an Owner whose System Administrator role is removed shows as Owner, and stays an administrator', async () => {
    const o2 = await makeSecondOwner();
    expectOk(await o2.agent.delete(`${API}/users/${w.admin.user.id}/roles/${roleId('System Administrator')}`));
    const admin = await reload(w.admin.user.id);
    expect([admin.roleId, admin.role]).toEqual([roleId('Owner'), 'admin']);
    const { users } = expectOk(await o2.agent.get(`${API}/users?scope=department`));
    expect(users.find((u) => u.id === w.admin.user.id).primaryRole.name).toBe('Owner');
  });

  it('another role the account holds becomes the main role, before the department default', async () => {
    await Department.update({ defaultRoleId: roleId('System Technician') }, { where: { id: w.deptA.id } });
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('Read Only') }), 201);
    expectOk(await w.admin.agent.delete(`${API}/users/${staff.user.id}/roles/${roleId('Department Staff')}`));
    expect((await reload(staff.user.id)).roleId).toBe(roleId('Read Only'));
    expect(await roleIdsOf(staff.user.id)).toEqual([roleId('Read Only')]);
  });

  it('with no role left, the department default still applies', async () => {
    await Department.update({ defaultRoleId: roleId('Read Only') }, { where: { id: w.deptA.id } });
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await w.admin.agent.delete(`${API}/users/${staff.user.id}/roles/${roleId('Department Staff')}`));
    expect((await reload(staff.user.id)).roleId).toBe(roleId('Read Only'));
    expect(await roleIdsOf(staff.user.id)).toEqual([roleId('Read Only')]);
  });

  it('deleting a role that was someone\'s main role moves them to another role they hold', async () => {
    const temp = expectOk(await w.admin.agent.post(`${API}/roles`).send({ name: 'Temp', permissionKeys: ['tickets.view_own'] }), 201).role;
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: temp.id }), 201);
    await User.update({ roleId: temp.id }, { where: { id: staff.user.id } });
    expectOk(await w.admin.agent.delete(`${API}/roles/${temp.id}`));
    expect((await reload(staff.user.id)).roleId).toBe(roleId('Department Staff'));
  });
});

describe('the legacy admin marker follows the top roles', () => {
  it('assigning System Administrator on the roles tab sets it', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Administrator') }), 201);
    expect((await reload(staff.user.id)).role).toBe('admin');
    expectOk(await staff.agent.post(`${API}/teams`).send({ name: 'Night shift' }), 201); // an older admin-only gate
  });

  it('removing the last top role clears it, so the older admin-only gates refuse', async () => {
    const sa = await createUserAndLogin({ username: 'sysadmin', roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: w.deptA.id });
    expectOk(await w.admin.agent.post(`${API}/users/${sa.user.id}/roles`).send({ roleId: roleId('Read Only') }), 201);
    expectOk(await w.admin.agent.delete(`${API}/users/${sa.user.id}/roles/${roleId('System Administrator')}`));
    expect((await reload(sa.user.id)).role).toBe('technician');
    expect((await sa.agent.post(`${API}/teams`).send({ name: 'Night shift' })).status).toBe(403);
  });
});

it('deleting an account removes its role assignments, overrides and company access', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/overrides`).send({ permissionKey: 'tickets.view_all', granted: true }), 201);
  await UserCompanyAccess.create({ userId: staff.user.id, companyId: (await models.Company.findOne()).id });
  expectOk(await w.admin.agent.delete(`${API}/users/${staff.user.id}`));
  expect([
    await UserRole.count({ where: { userId: staff.user.id } }),
    await UserPermissionOverride.count({ where: { userId: staff.user.id } }),
    await UserCompanyAccess.count({ where: { userId: staff.user.id } }),
  ]).toEqual([0, 0, 0]);
});

describe('the repair migration', () => {
  const run = () => migration.up(sequelize.getQueryInterface(), Sequelize);

  it('gives an account with no main role the best role it holds, and the admin marker for a top role', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await UserRole.create({ userId: staff.user.id, roleId: roleId('Owner'), assignedAt: new Date() });
    await User.update({ roleId: null, role: 'technician' }, { where: { id: staff.user.id } });
    await run();
    const fixed = await reload(staff.user.id);
    expect([fixed.roleId, fixed.role]).toEqual([roleId('Owner'), 'admin']);
  });

  it('records a main role the account had no assignment row for', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await UserRole.destroy({ where: { userId: staff.user.id } });
    await run();
    expect(await roleIdsOf(staff.user.id)).toEqual([roleId('Department Staff')]);
  });

  it('clears the admin marker of an account holding no top role while an Owner exists', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await User.update({ role: 'admin' }, { where: { id: staff.user.id } });
    await run();
    expect((await reload(staff.user.id)).role).toBe('technician');
  });

  it('leaves the marker alone when there is no Owner to fall back on', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await User.update({ role: 'admin' }, { where: { id: staff.user.id } });
    await UserRole.destroy({ where: { roleId: roleId('Owner') } });
    await run();
    expect((await reload(staff.user.id)).role).toBe('admin');
  });

  it('removes role assignments, overrides and company access of deleted accounts', async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await UserRole.create({ userId: 9999, roleId: roleId('Read Only'), assignedAt: new Date() });
    await UserPermissionOverride.create({ userId: 9999, permissionKey: 'tickets.view_all', granted: true });
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await run();
    expect([await UserRole.count({ where: { userId: 9999 } }), await UserPermissionOverride.count({ where: { userId: 9999 } })]).toEqual([0, 0]);
  });
});
