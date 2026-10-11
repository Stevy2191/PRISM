const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeManager, makeStaff,
} = require('./fixtures');

// The owner (System Administrator) may hand out any role (user decision
// 2026-10-11). Anyone else who manages roles may hand out only roles that
// carry nothing more than they hold themselves — assigning one, choosing one
// for a new account, or making one a department's default.

let w;
let mgr;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const refused = { error: true, message: 'You can only grant permissions you hold', code: 'FORBIDDEN' };

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  mgr = await makeManager('mgr', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'people.manage_roles', granted: true }), 201);
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
});
afterAll(closeDb);

it('assigning: a role carrying more than the assigner holds is refused; one within their reach is not', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  expect((await mgr.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Technician') })).body).toEqual(refused);
  const role = roles.find((r) => r.name === 'Read Only');
  const res = await mgr.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: role.id, ...(role.scope === 'department' ? { departmentId: w.deptA.id } : {}) });
  expect(res.status).toBeLessThan(300);
});

it('a new account: choosing a role beyond the creator\'s reach is refused, and nothing is created', async () => {
  const res = await mgr.agent.post(`${API}/users`).send({
    username: 'newbie', password: 'Correct-horse-1', displayName: 'Newbie', email: 'newbie@example.com',
    departmentId: w.deptA.id, roleId: roleId('System Technician'),
  });
  expect(res.body).toEqual(refused);
  expect(await models.User.count({ where: { username: 'newbie' } })).toBe(0);
});

it('a department\'s default role beyond the setter\'s reach is refused', async () => {
  expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'people.manage_departments', granted: true }), 201);
  const res = await mgr.agent.patch(`${API}/departments/${w.deptA.id}`).send({ defaultRoleId: roleId('System Technician') });
  expect(res.body).toEqual(refused);
});

it('the owner (System Administrator) hands out any role', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  expect((await w.admin.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Technician') })).status).toBeLessThan(300);
});
