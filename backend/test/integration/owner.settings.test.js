const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeStaff } = require('./fixtures');

// Sign-in, mail and integration settings need an Owner (user decision
// 2026-10-11): each is a way to take over accounts or read mail.

let w;
let sysadmin;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  sysadmin = await makeStaff('sysadmin', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${sysadmin.user.id}/roles`)
    .send({ roleId: roles.find((r) => r.name === 'System Administrator').id }), 201);
});
afterAll(closeDb);

it('a System Administrator is refused every Owner-only setting; an Owner is not', async () => {
  const calls = [
    ['get', '/sso-admin/providers'], ['get', '/settings/ldap'], ['patch', '/settings/ldap'],
    ['get', '/settings/smtp'], ['patch', '/settings/smtp'], ['get', '/settings/inbound-email'],
    ['get', '/ad-sync/settings'], ['post', '/ad-sync/group-mappings'],
  ];
  for (const [verb, path] of calls) {
    // eslint-disable-next-line no-await-in-loop
    const res = await sysadmin.agent[verb](`${API}${path}`).send({});
    expect([path, res.status, res.body.code]).toEqual([path, 403, 'OWNER_ONLY']);
  }
  expect((await w.admin.agent.get(`${API}/settings/ldap`)).status).toBe(200);
});

it('integration secrets in the general settings need an Owner; other settings do not', async () => {
  const refused = await sysadmin.agent.put(`${API}/settings`).send({ settings: { 'integrations.googleClientSecret': 'evil' } });
  expect([refused.status, refused.body.code]).toEqual([403, 'OWNER_ONLY']);
  expectOk(await sysadmin.agent.put(`${API}/settings`).send({ settings: { 'company.name': 'Acme' } }));
  expectOk(await w.admin.agent.put(`${API}/settings`).send({ settings: { 'integrations.googleClientId': 'mine' } }));
});

it('PATCH /settings with a bare body is gated the same way', async () => {
  const refused = await sysadmin.agent.patch(`${API}/settings`).send({ 'integrations.microsoftClientSecret': 'evil' });
  expect([refused.status, refused.body.code]).toEqual([403, 'OWNER_ONLY']);
});
