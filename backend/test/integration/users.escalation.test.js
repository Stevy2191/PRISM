const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeCompany, setCompanyAccess,
} = require('./fixtures');

// S11: user-administration permissions could hand out System Administrator,
// which no company fence applies to. Found by plan 2a's security review.

const { Company, Role, User, UserCompanyAccess } = models;

let w;
let mgr;
let tech;
let sysAdmin;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const PASSWORD = 'Correct-Horse-Battery-9';
const newUser = (agent, fields) => agent.post(`${API}/users`).send({
  username: `u${Math.random().toString(36).slice(2, 8)}`, displayName: 'New Person', password: PASSWORD, ...fields,
});

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  mgr = await makeManager('mgr', w.deptA.id);
  tech = await makeTech('tech', w.deptA.id);
  sysAdmin = await Role.findOne({ where: { name: 'System Administrator' } });
});
afterAll(closeDb);

describe('a user administrator who isn\'t a System Administrator', () => {
  it('can\'t make anyone, themselves included, an administrator', async () => {
    expectErr(await mgr.agent.patch(`${API}/users/${mgr.user.id}`).send({ role: 'admin' }), 403, 'FORBIDDEN', 'Changing a role needs people.manage_roles');
    expectErr(await mgr.agent.patch(`${API}/users/${tech.user.id}`).send({ role: 'admin' }), 403, 'FORBIDDEN', 'Changing a role needs people.manage_roles');
    expect((await User.findByPk(mgr.user.id)).role).not.toBe('admin');
  });

  it('can\'t create an administrator account', async () => {
    expectErr(await newUser(mgr.agent, { roleId: sysAdmin.id }), 403, 'FORBIDDEN', 'Choosing a role needs people.manage_roles');
    expectErr(await newUser(mgr.agent, { role: 'admin' }), 403, 'FORBIDDEN', 'Choosing a role needs people.manage_roles');
  });

  it('can\'t create one through a department whose default role is System Administrator', async () => {
    expectOk(await a().patch(`${API}/departments/${w.deptA.id}`).send({ defaultRoleId: sysAdmin.id }));
    expectErr(
      await newUser(mgr.agent, { departmentId: w.deptA.id }),
      403, 'FORBIDDEN', 'Only a System Administrator can grant the System Administrator role'
    );
  });

  it('can still create an ordinary account and reset an ordinary password', async () => {
    const made = expectOk(await newUser(mgr.agent, { departmentId: w.deptB.id }), 201).user;
    expect(made.role).toBe('technician');
    expectOk(await mgr.agent.patch(`${API}/users/${tech.user.id}`).send({ password: PASSWORD }));
  });

  it('can\'t reset an administrator\'s password', async () => {
    expectErr(
      await mgr.agent.patch(`${API}/users/${w.admin.user.id}`).send({ password: PASSWORD }),
      403, 'FORBIDDEN', 'Only a System Administrator can reset a System Administrator\'s password'
    );
  });

  it('can\'t set a department\'s default role without people.manage_roles', async () => {
    expectOk(await a().post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'people.manage_departments', granted: true }), 201);
    const staff = await Role.findOne({ where: { name: 'Department Staff' } });
    expectErr(
      await mgr.agent.patch(`${API}/departments/${w.deptB.id}`).send({ defaultRoleId: staff.id }),
      403, 'FORBIDDEN', 'Setting a default role needs people.manage_roles'
    );
  });
});

describe('a System Administrator', () => {
  it('can still make someone an administrator, but not change their own role or permissions', async () => {
    expectOk(await a().patch(`${API}/users/${tech.user.id}`).send({ role: 'admin' }));
    expectErr(await a().patch(`${API}/users/${w.admin.user.id}`).send({ role: 'technician' }), 403, 'FORBIDDEN', 'You cannot change your own roles');
    expectErr(
      await a().post(`${API}/users/${w.admin.user.id}/overrides`).send({ permissionKey: 'tickets.delete', granted: false }),
      403, 'FORBIDDEN', 'You cannot change your own permissions'
    );
  });
});

it('an account made by a fenced creator starts with the creator\'s companies', async () => {
  const internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  const acme = await makeCompany(w.admin, { name: 'Acme' });
  await setCompanyAccess(w.admin, mgr.user.id, { allCompanies: false, companyIds: [internalId, acme.id] });
  const made = expectOk(await newUser(mgr.agent, { departmentId: w.deptA.id }), 201).user;
  const fresh = await User.findByPk(made.id);
  expect(fresh.allCompanies).toBe(false);
  const rows = await UserCompanyAccess.findAll({ where: { userId: made.id } });
  expect(rows.map((r) => r.companyId).sort()).toEqual([internalId, acme.id].sort());
});
