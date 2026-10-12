const {
  resetData, closeDb, models, ROLE, createUserAndLogin,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeUser,
} = require('./fixtures');

// The Owner role's security review: the findings fixed in its one fix pass.

let w;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const ownerOnly = (what) => ({ error: true, message: `${what} needs an Owner`, code: 'OWNER_ONLY' });
// A System Administrator who is not an Owner, with the legacy 'admin' role too
// (some older gates still read it).
const makeSysadmin = () => createUserAndLogin({ username: 'sysadmin', roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: w.deptA.id });

beforeEach(async () => {
  await resetData();
  await models.Role.destroy({ where: { name: 'Temp' } }); // roles are not reset between tests
  w = await makeWorld();
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
});
afterEach(() => models.Role.destroy({ where: { name: 'Temp' } }));
afterAll(closeDb);

describe('M1: falling back to a department default never hands out a top role', () => {
  it('a department\'s default role can\'t be System Administrator, even for an owner', async () => {
    const res = await w.admin.agent.patch(`${API}/departments/${w.deptA.id}`).send({ defaultRoleId: roleId('System Administrator') });
    expect([res.status, res.body.message]).toEqual([400, 'A department\'s default role can\'t be System Administrator']);
  });

  it('removing a main role that would fall back to a top role is refused for a non-Owner', async () => {
    const sa = await makeSysadmin();
    const staff = await makeStaff('staff', w.deptA.id);
    await models.Department.update({ defaultRoleId: roleId('System Administrator') }, { where: { id: w.deptA.id } }); // set before this fix
    const res = await sa.agent.delete(`${API}/users/${staff.user.id}/roles/${roleId('Department Staff')}`);
    expect(res.body).toEqual(ownerOnly('Granting the System Administrator role'));
    expect(await models.UserRole.count({ where: { userId: staff.user.id, roleId: roleId('System Administrator') } })).toBe(0);
  });

  it('deleting a role whose holders would fall back to a top role is refused for a non-Owner', async () => {
    const sa = await makeSysadmin();
    const custom = expectOk(await w.admin.agent.post(`${API}/roles`).send({ name: 'Temp', permissionKeys: ['tickets.view_own'] }), 201).role;
    await makeUser('temp', 'Temp', w.deptA.id);
    await models.Department.update({ defaultRoleId: roleId('System Administrator') }, { where: { id: w.deptA.id } });
    const res = await sa.agent.delete(`${API}/roles/${custom.id}`);
    expect(res.body).toEqual(ownerOnly('Granting the System Administrator role'));
    expect(await models.Role.count({ where: { id: custom.id } })).toBe(1);
  });
});

it('L1: the general settings don\'t return sign-in and mail settings', async () => {
  await models.SystemSettings.upsert({ key: 'smtp.host', value: 'mail.example.com' });
  const sa = await makeSysadmin();
  const { settings } = expectOk(await sa.agent.get(`${API}/settings`));
  expect(Object.keys(settings).filter((k) => /^(ldap|smtp|inboundEmail|sso|adSync)\./.test(k))).toEqual([]);
  expect(settings).toHaveProperty(['company.timezone']);
});

it('L2/L3: an administrator can\'t revoke an Owner\'s API key or change their preferences', async () => {
  const sa = await makeSysadmin();
  const { apiKey } = expectOk(await w.admin.agent.post(`${API}/apikeys`).send({ name: 'Owner integration' }), 201);
  expect((await sa.agent.delete(`${API}/apikeys/${apiKey.id}`)).body).toEqual(ownerOnly('Changing an administrator\'s account'));
  expect((await sa.agent.patch(`${API}/users/${w.admin.user.id}/preferences`).send({ timerMode: 'automatic' })).body)
    .toEqual(ownerOnly('Changing an administrator\'s account'));
});

it('L4: single sign-on can\'t grant System Administrator', async () => {
  const provider = expectOk(await w.admin.agent.post(`${API}/sso-admin/providers`).send({
    name: 'Entra', slug: 'entra', protocol: 'oidc', config: { issuerUrl: 'https://login.example.com/v2.0', clientId: 'abc' }, clientSecret: 'x',
  }), 201).provider;
  const refused = 'Single sign-on can\'t grant the System Administrator role';
  const mapping = await w.admin.agent.post(`${API}/sso-admin/providers/${provider.id}/mappings`).send({ claimValue: 'admins', roleId: roleId('System Administrator') });
  expect([mapping.status, mapping.body.message]).toEqual([400, refused]);
  const def = await w.admin.agent.patch(`${API}/sso-admin/providers/${provider.id}`).send({ defaultRoleId: roleId('System Administrator') });
  expect([def.status, def.body.message]).toEqual([400, refused]);
});

it('L8: the permissions view shows a secondary owner holding everything', async () => {
  const second = await createUserAndLogin({ username: 'second', roleName: ROLE.ADMIN, legacyRole: 'admin', ownerLevel: 'secondary' });
  await models.UserPermissionOverride.create({ userId: second.user.id, permissionKey: 'tickets.view_all', granted: false });
  const { permissions } = expectOk(await w.admin.agent.get(`${API}/users/${second.user.id}/permissions`));
  expect(permissions.filter((p) => !p.granted)).toEqual([]);
  expect(permissions.find((p) => p.key === 'tickets.view_all').source).toBe('Owner');
});
