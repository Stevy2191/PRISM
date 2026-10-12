const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize, createUserAndLogin, ROLE,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeUser,
} = require('./fixtures');
const { resolveUserPermissions, invalidateAllPermissions } = require('../../src/services/permissionService');
const { recoverOwnership } = require('../../src/services/ownership');
const migration = require('../../migrations/20260101000057-owner-mark');

// Ownership is a mark on a System Administrator's account (user decision
// 2026-10-11): one owner (a local account) and any number of secondary
// owners the owner sets. Both have every permission and the owner powers;
// only the owner marks owners and hands ownership on.

const { User, UserRole, Role, AuditLog } = models;

let w;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const PASSWORD = 'IntegrationPass!2026'; // createUser's default
const level = async (id) => (await User.findByPk(id)).ownerLevel;
const err = (res) => [res.status, res.body.code, res.body.message];
const makeSysadmin = (username = 'sysadmin') => createUserAndLogin({ username, roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: w.deptA.id });
const markSecondary = (target, on = true) => w.admin.agent.put(`${API}/users/${target.user.id}/owner`).send({ secondary: on });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
});
afterAll(closeDb);

it('there is no Owner role any more: ownership is a mark', async () => {
  expect(roles.map((r) => r.name)).not.toContain('Owner');
  const me = expectOk(await w.admin.agent.get(`${API}/auth/me`)).user;
  expect([me.isOwner, me.ownerLevel]).toEqual([true, 'owner']);
});

it('the owner holds every permission, even against a deny override, and reaches every company', async () => {
  await models.UserPermissionOverride.create({ userId: w.admin.user.id, permissionKey: 'tickets.view_all', granted: false });
  invalidateAllPermissions();
  const perms = await resolveUserPermissions(w.admin.user.id);
  expect(Object.entries(perms).filter(([, v]) => !v)).toEqual([]);
  expect(expectOk(await w.admin.agent.get(`${API}/users/${w.admin.user.id}/company-access`)).access.unfenceable).toBe(true);
  const { permissions } = expectOk(await w.admin.agent.get(`${API}/users/${w.admin.user.id}/permissions`));
  expect(permissions.find((p) => p.key === 'tickets.view_all')).toMatchObject({ granted: true, source: 'Owner' });
});

describe('secondary owners', () => {
  it('the owner marks a System Administrator, who then has the owner powers', async () => {
    const sa = await makeSysadmin();
    expect(expectOk(await sa.agent.get(`${API}/auth/me`)).user.isOwner).toBe(false);
    expect(expectOk(await markSecondary(sa)).user.ownerLevel).toBe('secondary');
    const me = expectOk(await sa.agent.get(`${API}/auth/me`)).user;
    expect([me.isOwner, me.ownerLevel]).toEqual([true, 'secondary']);
    // An owner power: making a System Administrator.
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await sa.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Administrator') }), 201);
    // Unmarked again, they lose it.
    expectOk(await markSecondary(sa, false));
    expect(await level(sa.user.id)).toBeNull();
    expect(expectOk(await sa.agent.get(`${API}/auth/me`)).user.isOwner).toBe(false);
  });

  it('only the owner marks owners: not a secondary owner, not a System Administrator', async () => {
    const sec = await makeSysadmin('sec');
    expectOk(await markSecondary(sec));
    const sa = await makeSysadmin('plain');
    const what = 'Marking owners is for the owner only';
    expect(err(await sec.agent.put(`${API}/users/${sa.user.id}/owner`).send({ secondary: true }))).toEqual([403, 'THE_OWNER_ONLY', what]);
    expect(err(await sa.agent.put(`${API}/users/${sa.user.id}/owner`).send({ secondary: true }))).toEqual([403, 'THE_OWNER_ONLY', what]);
    expect(await level(sa.user.id)).toBeNull();
  });

  it('only a System Administrator can be marked, and the owner can\'t mark themselves', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expect(err(await markSecondary(staff))).toEqual([400, 'VALIDATION_ERROR', 'Only a System Administrator can be marked as an owner']);
    expect(err(await w.admin.agent.put(`${API}/users/${w.admin.user.id}/owner`).send({ secondary: true })))
      .toEqual([400, 'VALIDATION_ERROR', 'You are the owner: hand ownership to someone else instead']);
  });

  it('a secondary owner can reset the owner\'s password', async () => {
    const sec = await makeSysadmin('sec');
    expectOk(await markSecondary(sec));
    expectOk(await sec.agent.patch(`${API}/users/${w.admin.user.id}`).send({ password: 'Brand-New-Password-7' }));
  });

  it('a System Administrator can\'t change an owner\'s account', async () => {
    const sa = await makeSysadmin();
    expect(err(await sa.agent.patch(`${API}/users/${w.admin.user.id}`).send({ password: 'Brand-New-Password-7' })))
      .toEqual([403, 'OWNER_ONLY', 'Changing an administrator\'s account needs an Owner']);
  });

  it('a marked account keeps System Administrator until the mark is removed', async () => {
    const sec = await makeSysadmin('sec');
    expectOk(await markSecondary(sec));
    expect(err(await w.admin.agent.delete(`${API}/users/${sec.user.id}/roles/${roleId('System Administrator')}`)))
      .toEqual([400, 'OWNER_MARKED', 'Remove their secondary-owner mark first']);
    expect(err(await w.admin.agent.patch(`${API}/users/${sec.user.id}`).send({ role: 'technician' })))
      .toEqual([400, 'OWNER_MARKED', 'Remove their secondary-owner mark first']);
  });
});

describe('the owner', () => {
  it('can\'t be deleted or lose System Administrator, even by a secondary owner', async () => {
    const sec = await makeSysadmin('sec');
    expectOk(await markSecondary(sec));
    const handOn = 'The owner\'s account stays: hand ownership to someone else first';
    expect(err(await sec.agent.delete(`${API}/users/${w.admin.user.id}`))).toEqual([400, 'THE_OWNER', handOn]);
    expect(err(await sec.agent.delete(`${API}/users/${w.admin.user.id}/roles/${roleId('System Administrator')}`))).toEqual([400, 'THE_OWNER', handOn]);
    expect(err(await sec.agent.patch(`${API}/users/${w.admin.user.id}`).send({ role: 'technician' }))).toEqual([400, 'THE_OWNER', handOn]);
    expect(await User.count({ where: { id: w.admin.user.id } })).toBe(1);
  });

  it('hands ownership to a local System Administrator with their password; they keep System Administrator', async () => {
    const sa = await makeSysadmin();
    const res = await w.admin.agent.post(`${API}/users/${sa.user.id}/owner/transfer`).send({ password: PASSWORD });
    expect(expectOk(res).user.ownerLevel).toBe('owner');
    expect(await level(w.admin.user.id)).toBeNull();
    expect((await User.findByPk(w.admin.user.id)).role).toBe('admin');
    expect(expectOk(await w.admin.agent.get(`${API}/auth/me`)).user.isOwner).toBe(false);
    const audit = await AuditLog.findOne({ where: { action: 'owner.transfer' } });
    expect(audit.meta).toEqual({ from: 'admin', to: 'sysadmin', via: 'app' });
  });

  it('a handover needs the right password, a local active System Administrator, and the owner', async () => {
    const sa = await makeSysadmin();
    const staff = await makeStaff('staff', w.deptA.id);
    const transfer = (agent, target, password = PASSWORD) => agent.post(`${API}/users/${target.user.id}/owner/transfer`).send({ password });
    expect(err(await transfer(w.admin.agent, sa, 'wrong'))).toEqual([403, 'WRONG_PASSWORD', 'Your password is incorrect']);
    expect(err(await transfer(w.admin.agent, staff))).toEqual([400, 'VALIDATION_ERROR', 'Only a System Administrator can become the owner']);
    await User.update({ isLocalAccount: false }, { where: { id: sa.user.id } });
    expect(err(await transfer(w.admin.agent, sa))).toEqual([400, 'VALIDATION_ERROR', 'The owner must be a local account (not a directory or single sign-on one)']);
    await User.update({ isLocalAccount: true, isActive: false }, { where: { id: sa.user.id } });
    expect(err(await transfer(w.admin.agent, sa))).toEqual([400, 'VALIDATION_ERROR', 'The owner must be an active account']);
    await User.update({ isActive: true }, { where: { id: sa.user.id } });
    const sec = await makeSysadmin('sec');
    expectOk(await markSecondary(sec));
    expect(err(await transfer(sec.agent, sa))).toEqual([403, 'THE_OWNER_ONLY', 'Handing over ownership is for the owner only']);
    expect(await level(w.admin.user.id)).toBe('owner');
  });

  it('a secondary owner who becomes the owner is no longer secondary', async () => {
    const sec = await makeSysadmin('sec');
    expectOk(await markSecondary(sec));
    expectOk(await w.admin.agent.post(`${API}/users/${sec.user.id}/owner/transfer`).send({ password: PASSWORD }));
    expect([await level(sec.user.id), await level(w.admin.user.id)]).toEqual(['owner', null]);
  });
});

describe('recovering ownership from the server', () => {
  it('moves ownership to a local account, makes it a System Administrator, and audits it', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const result = await recoverOwnership('staff');
    expect(result).toEqual({ from: 'admin', to: 'staff' });
    const u = await User.findByPk(staff.user.id);
    expect([u.ownerLevel, u.role]).toEqual(['owner', 'admin']);
    expect(await UserRole.count({ where: { userId: staff.user.id, roleId: roleId('System Administrator') } })).toBe(1);
    expect(await level(w.admin.user.id)).toBeNull();
    const audit = await AuditLog.findOne({ where: { action: 'owner.transfer' } });
    expect([audit.userId, audit.meta]).toEqual([null, { from: 'admin', to: 'staff', via: 'server command' }]);
  });

  it('refuses an unknown, inactive or directory account', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await expect(recoverOwnership('nobody')).rejects.toThrow('No account with the username "nobody"');
    await User.update({ isActive: false }, { where: { id: staff.user.id } });
    await expect(recoverOwnership('staff')).rejects.toThrow('The owner must be an active account');
    await User.update({ isActive: true, isLocalAccount: false }, { where: { id: staff.user.id } });
    await expect(recoverOwnership('staff')).rejects.toThrow('The owner must be a local account (not a directory or single sign-on one)');
    expect(await level(w.admin.user.id)).toBe('owner');
  });
});

describe('the migration', () => {
  const qi = () => sequelize.getQueryInterface();
  // The state before it: an Owner role, held by accounts with no mark.
  async function ownerRoleState(holders) {
    await User.update({ ownerLevel: null }, { where: {} });
    const role = await Role.create({ name: 'Owner', isSystemRole: true, scope: 'system' });
    for (const u of holders) {
      // eslint-disable-next-line no-await-in-loop
      await UserRole.create({ userId: u.id, roleId: role.id, assignedAt: new Date() });
    }
    return role;
  }

  it('makes the oldest used local Owner the owner, the other Owners secondary, and removes the role', async () => {
    const second = await makeUser('second', ROLE.READ_ONLY, w.deptA.id); // an Owner without System Administrator
    const role = await ownerRoleState([w.admin.user, second.user]);
    await models.Department.update({ defaultRoleId: role.id }, { where: { id: w.deptA.id } });
    await migration.up(qi(), Sequelize);
    expect([await level(w.admin.user.id), await level(second.user.id)]).toEqual(['owner', 'secondary']);
    expect(await Role.count({ where: { name: 'Owner', isSystemRole: true } })).toBe(0);
    expect(await UserRole.count({ where: { roleId: role.id } })).toBe(0);
    expect((await models.Department.findByPk(w.deptA.id)).defaultRoleId).toBeNull();
    const s = await User.findByPk(second.user.id);
    expect(s.role).toBe('admin');
    expect(await UserRole.count({ where: { userId: second.user.id, roleId: roleId('System Administrator') } })).toBe(1);
  });

  it('skips a directory or unused Owner for the crown', async () => {
    const used = await makeSysadmin('used');
    await User.update({ isLocalAccount: false }, { where: { id: w.admin.user.id } });
    await ownerRoleState([w.admin.user, used.user]);
    await migration.up(qi(), Sequelize);
    expect([await level(used.user.id), await level(w.admin.user.id)]).toEqual(['owner', 'secondary']);
  });

  it('round-trips', async () => {
    await migration.down(qi(), Sequelize);
    const role = await Role.findOne({ where: { name: 'Owner', isSystemRole: true } });
    expect(await UserRole.count({ where: { roleId: role.id, userId: w.admin.user.id } })).toBe(1);
    await migration.up(qi(), Sequelize);
    expect(await level(w.admin.user.id)).toBe('owner');
    expect(await Role.count({ where: { name: 'Owner', isSystemRole: true } })).toBe(0);
  });
});
