const {
  resetData, closeDb, models, createUserAndLogin, login, ROLE,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeManager,
} = require('./fixtures');

// Creating an account with its role and permission overrides in one step, and
// changing usernames (user request 2026-10-11).

const {
  User, UserRole, UserPermissionOverride, AuditLog,
} = models;

let w;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const PASSWORD = 'Correct-Horse-Battery-9';
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const newUser = (agent, fields) => agent.post(`${API}/users`).send({
  username: 'newbie', displayName: 'New Person', password: PASSWORD, ...fields,
});
const newbieCount = () => User.count({ where: { username: 'newbie' } });
// A System Administrator who is not an Owner.
const makeSysadmin = () => createUserAndLogin({ username: 'sysadmin', roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: w.deptA.id });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
});
afterAll(closeDb);

describe('creating an account with its role', () => {
  it('lists which roles the creator may hand out', async () => {
    const sa = await makeSysadmin();
    const grantable = (list) => Object.fromEntries(list.filter((r) => ['Owner', 'System Administrator', 'Department Staff'].includes(r.name))
      .map((r) => [r.name, r.grantable]));
    expect(grantable(expectOk(await sa.agent.get(`${API}/roles?grantable=1`)).roles))
      .toEqual({ Owner: false, 'System Administrator': false, 'Department Staff': true });
    expect(grantable(expectOk(await w.admin.agent.get(`${API}/roles?grantable=1`)).roles))
      .toEqual({ Owner: true, 'System Administrator': true, 'Department Staff': true });
  });

  it('an Owner makes a System Administrator, who also gets the legacy admin role', async () => {
    const made = expectOk(await newUser(w.admin.agent, { roleId: roleId('System Administrator') }), 201).user;
    expect(made.role).toBe('admin');
    expect((await UserRole.findAll({ where: { userId: made.id } })).map((r) => r.roleId)).toEqual([roleId('System Administrator')]);
  });

  it('a System Administrator can\'t make an Owner or System Administrator, and nothing is created', async () => {
    const sa = await makeSysadmin();
    for (const name of ['Owner', 'System Administrator']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await newUser(sa.agent, { roleId: roleId(name) });
      expect([name, res.status, res.body.code]).toEqual([name, 403, 'OWNER_ONLY']);
    }
    expect(await newbieCount()).toBe(0);
  });

  it('a department role applies within the account\'s department', async () => {
    const made = expectOk(await newUser(w.admin.agent, { roleId: roleId('Department Staff'), departmentId: w.deptA.id }), 201).user;
    expect((await UserRole.findAll({ where: { userId: made.id }, raw: true })).map((r) => [r.roleId, r.departmentId]))
      .toEqual([[roleId('Department Staff'), w.deptA.id]]);
  });

  it('a department role without a department is refused', async () => {
    expectErr(await newUser(w.admin.agent, { roleId: roleId('Department Staff') }), 400, 'VALIDATION_ERROR',
      'Choose a department: the Department Staff role applies within one');
    expect(await newbieCount()).toBe(0);
  });
});

describe('creating an account with permission overrides', () => {
  it('saves them, granted by the creator', async () => {
    const made = expectOk(await newUser(w.admin.agent, {
      roleId: roleId('Read Only'),
      overrides: [
        { permissionKey: 'tickets.view_all', granted: true, reason: 'Covering the desk' },
        { permissionKey: 'tickets.view_own', granted: false },
      ],
    }), 201).user;
    const rows = await UserPermissionOverride.findAll({ where: { userId: made.id }, order: [['permissionKey', 'ASC']], raw: true });
    expect(rows.map((o) => [o.permissionKey, !!o.granted, o.reason, o.grantedBy])).toEqual([
      ['tickets.view_all', true, 'Covering the desk', w.admin.user.id],
      ['tickets.view_own', false, null, w.admin.user.id],
    ]);
  });

  it('needs people.manage_permission_overrides, and nothing is created without it', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    expectErr(await newUser(mgr.agent, { departmentId: w.deptA.id, overrides: [{ permissionKey: 'tickets.view_own', granted: true }] }),
      403, 'FORBIDDEN', 'Adding permission overrides needs people.manage_permission_overrides');
    expect(await newbieCount()).toBe(0);
  });

  it('a grant beyond the creator\'s reach is refused, and nothing is created', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'people.manage_permission_overrides', granted: true }), 201);
    expectErr(await newUser(mgr.agent, { departmentId: w.deptA.id, overrides: [{ permissionKey: 'settings.manage_system', granted: true }] }),
      403, 'FORBIDDEN', 'You can only grant permissions you hold');
    expect(await newbieCount()).toBe(0);
  });

  it('an unknown permission or a malformed override is refused, and nothing is created', async () => {
    expectErr(await newUser(w.admin.agent, { overrides: [{ permissionKey: 'nope.nothing', granted: true }] }),
      400, 'VALIDATION_ERROR', 'Unknown permission: nope.nothing');
    expectErr(await newUser(w.admin.agent, { overrides: [{ permissionKey: 'tickets.view_all', granted: 'yes' }] }),
      400, 'VALIDATION_ERROR', 'granted must be true or false');
    expectErr(await newUser(w.admin.agent, { overrides: 'tickets.view_all' }),
      400, 'VALIDATION_ERROR', 'overrides must be a list');
    expectErr(await newUser(w.admin.agent, {
      overrides: [{ permissionKey: 'tickets.view_all', granted: true }, { permissionKey: 'tickets.view_all', granted: false }],
    }), 400, 'VALIDATION_ERROR', 'tickets.view_all is listed twice');
    expect(await newbieCount()).toBe(0);
  });

  it('a database failure part-way leaves no account behind', async () => {
    const spy = jest.spyOn(UserPermissionOverride, 'bulkCreate').mockRejectedValueOnce(new Error('disk full'));
    try {
      const res = await newUser(w.admin.agent, { overrides: [{ permissionKey: 'tickets.view_all', granted: true }] });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await newbieCount()).toBe(0);
  });
});

describe('usernames', () => {
  const INVALID = 'Usernames are 3 to 64 characters: letters, numbers, dots, dashes and underscores';

  it('a new account\'s username must be well formed and not taken, ignoring case', async () => {
    for (const username of ['ab', 'sam@example.com', 'two words', 'x'.repeat(65)]) {
      // eslint-disable-next-line no-await-in-loop
      expectErr(await newUser(w.admin.agent, { username }), 400, 'INVALID_USERNAME', INVALID);
    }
    expectErr(await newUser(w.admin.agent, { username: 'ADMIN' }), 409, 'USERNAME_TAKEN', 'A user with this username already exists');
  });

  it('an Owner renames themselves, stays signed in, and signs in with the new name', async () => {
    const res = await w.admin.agent.patch(`${API}/users/${w.admin.user.id}`).send({ username: 'sam.owner' });
    expect(expectOk(res).user.username).toBe('sam.owner');
    expect(expectOk(await w.admin.agent.get(`${API}/auth/me`)).user.username).toBe('sam.owner');
    await expect(login('sam.owner', w.admin.password)).resolves.toBeTruthy();
    await expect(login('admin', w.admin.password)).rejects.toThrow(/401/);
    const audit = await AuditLog.findOne({ where: { action: 'user.rename', entityId: w.admin.user.id } });
    expect(audit.meta).toEqual({ from: 'admin', to: 'sam.owner' });
  });

  it('a user administrator renames an ordinary account', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const staff = await makeStaff('staff', w.deptA.id);
    expect(expectOk(await mgr.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'staff.two' })).user.username).toBe('staff.two');
  });

  it('only an Owner renames an administrator', async () => {
    const sa = await makeSysadmin();
    expectErr(await sa.agent.patch(`${API}/users/${w.admin.user.id}`).send({ username: 'hijacked' }),
      403, 'OWNER_ONLY', 'Changing an administrator\'s account needs an Owner');
    expect((await User.findByPk(w.admin.user.id)).username).toBe('admin');
  });

  it('someone without people.edit_users can\'t rename themselves', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expectErr(await staff.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'admin2' }),
      403, 'FORBIDDEN', 'Changing a username needs people.edit_users');
    // Sending their own name back (the whole form) is not a change.
    expectOk(await staff.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'staff', jobTitle: 'Clerk' }));
  });

  it('a directory account keeps its provider\'s username', async () => {
    const staff = await makeStaff('dirperson', w.deptA.id);
    await User.update({ isLocalAccount: false }, { where: { id: staff.user.id } });
    expectErr(await w.admin.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'renamed' }),
      400, 'NOT_LOCAL_ACCOUNT', 'A directory or single sign-on account keeps the username its provider gives it');
  });

  it('a new username must be well formed and not taken; a change of case alone is fine', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expectErr(await w.admin.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'boss@example.com' }), 400, 'INVALID_USERNAME', INVALID);
    expectErr(await w.admin.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'Admin' }), 409, 'USERNAME_TAKEN', 'A user with this username already exists');
    expect(expectOk(await w.admin.agent.patch(`${API}/users/${staff.user.id}`).send({ username: 'Staff' })).user.username).toBe('Staff');
  });
});

it('the user list marks administrators, so the screen can keep their rows read-only for non-Owners', async () => {
  const sa = await makeSysadmin();
  const staff = await makeStaff('staff', w.deptA.id);
  const { users } = expectOk(await w.admin.agent.get(`${API}/users?scope=department`));
  const flag = (id) => users.find((u) => u.id === id).administrator;
  expect([flag(w.admin.user.id), flag(sa.user.id), flag(staff.user.id)]).toEqual([true, true, false]);
});

describe('signing in when an email looks like someone\'s username', () => {
  it('a username match wins over an email match (older data)', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    // The model refuses such an email; older or imported data may hold one.
    // The admin row moves after it, so a lookup by either would reach it first.
    await User.update({ email: 'admin' }, { where: { id: staff.user.id }, validate: false });
    await User.update({ id: 999 }, { where: { id: w.admin.user.id } });
    await expect(login('admin', w.admin.password)).resolves.toBeTruthy();
  });
});
