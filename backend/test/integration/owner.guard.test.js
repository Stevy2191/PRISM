const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeStaff } = require('./fixtures');

// Only owners make System Administrators or change an administrator's
// account; a System Administrator manages everything below. (Marking owners:
// owner.mark.test.js.)

let w;
let sysadmin;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const ownerOnly = (what) => ({ error: true, message: `${what} needs an Owner`, code: 'OWNER_ONLY' });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  sysadmin = await makeStaff('sysadmin', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${sysadmin.user.id}/roles`).send({ roleId: roleId('System Administrator') }), 201);
});
afterAll(closeDb);

it('a System Administrator can\'t make administrators, by any path', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  const a = sysadmin.agent;
  expect((await a.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Administrator') })).body)
    .toEqual(ownerOnly('Granting the System Administrator role'));
  expect((await a.patch(`${API}/users/${staff.user.id}`).send({ role: 'admin' })).body)
    .toEqual(ownerOnly('Granting the System Administrator role'));
  // A top role is never a department default, for anyone (Owner review M1).
  expect((await a.patch(`${API}/departments/${w.deptA.id}`).send({ defaultRoleId: roleId('System Administrator') })).body.message)
    .toBe('A department\'s default role can\'t be System Administrator');
  // Below them, they manage freely.
  expect((await a.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Technician') })).status).toBeLessThan(300);
});

it('a System Administrator can\'t change another administrator\'s or an Owner\'s account', async () => {
  const other = await makeStaff('other', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${other.user.id}/roles`).send({ roleId: roleId('System Administrator') }), 201);
  const a = sysadmin.agent;
  const what = 'Changing an administrator\'s account';
  for (const target of [other.user.id, w.admin.user.id]) {
    for (const res of [
      // eslint-disable-next-line no-await-in-loop
      await a.post(`${API}/users/${target}/overrides`).send({ permissionKey: 'tickets.view_all', granted: false }),
      // eslint-disable-next-line no-await-in-loop
      await a.patch(`${API}/users/${target}`).send({ jobTitle: 'Demoted' }),
      // eslint-disable-next-line no-await-in-loop
      await a.put(`${API}/users/${target}/company-access`).send({ allCompanies: false, companyIds: [] }),
    ]) {
      expect(res.body).toEqual(ownerOnly(what));
    }
    // Deleting a user is gated on the legacy admin role first: refused either way.
    expect((await a.delete(`${API}/users/${target}`)).status).toBe(403); // eslint-disable-line no-await-in-loop
  }
  expect((await a.delete(`${API}/users/${other.user.id}/roles/${roleId('System Administrator')}`)).body).toEqual(ownerOnly(what));
});
