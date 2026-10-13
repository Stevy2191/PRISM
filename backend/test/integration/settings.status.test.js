// backend/test/integration/settings.status.test.js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeStaff } = require('./fixtures');

// The Settings overview's status hints (spec: Settings redesign): owners
// only, and only booleans and counts, never a host, address or secret.

let w;
// resetData keeps SystemSettings, so this file clears the keys it sets.
const MAIL_KEYS = ['smtp.host', 'smtp.fromEmail', 'inboundEmail.enabled'];
beforeEach(async () => {
  await resetData();
  await models.SystemSettings.destroy({ where: { key: MAIL_KEYS } });
  w = await makeWorld();
});
afterAll(() => models.SystemSettings.destroy({ where: { key: MAIL_KEYS } }));
afterAll(closeDb);

const status = (u) => u.agent.get(`${API}/settings/status`);

it('an owner gets booleans and counts', async () => {
  const body = expectOk(await status(w.admin));
  expect(body).toEqual({
    directory: { configured: expect.any(Boolean), connected: expect.any(Boolean) },
    incomingEmail: { enabled: false },
    outgoingEmail: { configured: false },
    singleSignOn: { enabled: 0 },
  });
});

it('reflects mail settings without repeating them', async () => {
  for (const [key, value] of [['smtp.host', 'mail.example.com'], ['smtp.fromEmail', 'desk@example.com'], ['inboundEmail.enabled', 'true']]) {
    await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  }
  const body = expectOk(await status(w.admin));
  expect([body.outgoingEmail.configured, body.incomingEmail.enabled]).toEqual([true, true]);
  expect(JSON.stringify(body)).not.toMatch(/example\.com/);
});

it('a System Administrator who is not an owner is refused; so is someone without system settings', async () => {
  const roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  const sysadmin = await makeStaff('sysadmin', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${sysadmin.user.id}/roles`)
    .send({ roleId: roles.find((r) => r.name === 'System Administrator').id }), 201);
  const res = await status(sysadmin);
  expect([res.status, res.body.code]).toEqual([403, 'OWNER_ONLY']);
  const staff = await makeStaff('staff', w.deptA.id);
  expect((await status(staff)).status).toBe(403);
});
