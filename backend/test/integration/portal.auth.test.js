// Mail is recorded, not sent.
jest.mock('../../src/services/emailSender', () => ({
  ...jest.requireActual('../../src/services/emailSender'),
  sendMail: jest.fn(async () => ({})),
}));

const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  makeWorld, makeContact, makeCompany, makeTech, setCompanyAccess, expectOk, waitFor,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const { sendMail } = require('../../src/services/emailSender');

// Sub-project 7a, task 2: contact sessions, invite links, sign-in, reset.

const API = '/api/v1';
const PASSWORD = 'Harbour-Lights-2026';
const settle = () => new Promise((r) => { setTimeout(r, 200); });
const mailsTo = (addr) => sendMail.mock.calls.map(([m]) => m).filter((m) => [].concat(m.to).includes(addr));
const tokenIn = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.html)[1];
const portal = () => request.agent(getApp());

let w;
beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
  await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
});
afterEach(unfreezeClock);
// Settings outlive resetData: leave the portal switched off for later suites.
afterAll(async () => {
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await closeDb();
});

async function invite(contact = w.contact, by = w.admin) {
  sendMail.mockClear();
  expectOk(await by.agent.post(`${API}/contacts/${contact.id}/portal-invite`));
  await waitFor(() => mailsTo(contact.email).length === 1);
  return tokenIn(mailsTo(contact.email)[0]);
}
async function signedIn(contact = w.contact) {
  const token = await invite(contact);
  const agent = portal();
  expectOk(await agent.post(`${API}/portal/auth/invite/accept`).send({ token, password: PASSWORD }));
  expectOk(await agent.post(`${API}/portal/auth/login`).send({ email: contact.email, password: PASSWORD }));
  return agent;
}

it('invite → accept → login works; the link works once', async () => {
  const token = await invite();
  const [mail] = mailsTo(w.contact.email);
  expect(mail.html).toContain('/portal/welcome?token=');
  expect((await models.Contact.findByPk(w.contact.id)).portalAccess).toBe(true);

  const agent = portal();
  // The invite page shows who the link is for before anything is spent.
  const check = expectOk(await agent.post(`${API}/portal/auth/invite/check`).send({ token }));
  expect(check).toEqual({ email: w.contact.email, companyName: expect.any(String) });
  expect((await agent.post(`${API}/portal/auth/invite/check`).send({ token: 'nope' })).status).toBe(400);
  // Setting the password signs the contact in.
  const accepted = expectOk(await agent.post(`${API}/portal/auth/invite/accept`).send({ token, password: PASSWORD }));
  expect(accepted.contact.id).toBe(w.contact.id);
  expectOk(await agent.get(`${API}/portal/me`));
  const again = await portal().post(`${API}/portal/auth/invite/accept`).send({ token, password: PASSWORD });
  expect([again.status, again.body.code]).toEqual([400, 'TOKEN_INVALID']);
  expect((await portal().post(`${API}/portal/auth/invite/check`).send({ token })).status).toBe(400);

  expectOk(await agent.post(`${API}/portal/auth/logout`));
  expect((await agent.get(`${API}/portal/me`)).status).toBe(401);
  const login = await agent.post(`${API}/portal/auth/login`).send({ email: w.contact.email.toUpperCase(), password: PASSWORD });
  expect(login.status).toBe(200);
  expect(JSON.stringify(login.body)).not.toContain('passwordHash');
  const { contact } = expectOk(await agent.get(`${API}/portal/me`));
  expect(contact).toMatchObject({
    id: w.contact.id, email: w.contact.email, isCompanyAdmin: false, adminDepartmentIds: [], signInMethod: 'password',
  });
  expect(contact.company).toEqual({ id: w.contact.companyId, name: expect.any(String) });
  expect(contact.department).toEqual({ id: w.deptA.id, name: 'Service Desk' });
  // The token is stored hashed only.
  const row = await models.PortalToken.findOne({ where: { contactId: w.contact.id } });
  expect(row.tokenHash).not.toBe(token);
  expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

  const audits = await models.AuditLog.findAll({ where: { entityType: 'Contact', entityId: w.contact.id } });
  expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['portal.invite_sent', 'portal.sign_in']));
});

it('a weak password is refused when accepting an invite', async () => {
  const token = await invite();
  const res = await portal().post(`${API}/portal/auth/invite/accept`).send({ token, password: 'password' });
  expect(res.status).toBe(400);
  // The link is not spent by a refused password.
  expectOk(await portal().post(`${API}/portal/auth/invite/accept`).send({ token, password: PASSWORD }));
});

it('an invite link older than 72 hours is refused', async () => {
  freezeClock('2026-03-02T09:00:00Z');
  const token = await invite();
  advanceClock(72 * 60 * 60 * 1000 + 60 * 1000);
  const res = await portal().post(`${API}/portal/auth/invite/accept`).send({ token, password: PASSWORD });
  expect([res.status, res.body.code]).toEqual([400, 'TOKEN_INVALID']);
});

it('a newer invite invalidates the older link', async () => {
  const first = await invite();
  const second = await invite();
  const old = await portal().post(`${API}/portal/auth/invite/accept`).send({ token: first, password: PASSWORD });
  expect([old.status, old.body.code]).toEqual([400, 'TOKEN_INVALID']);
  expectOk(await portal().post(`${API}/portal/auth/invite/accept`).send({ token: second, password: PASSWORD }));
});

it('forgot password answers 202 for unknown and known emails alike, and emails only the known one', async () => {
  await signedIn();
  sendMail.mockClear();
  const unknown = await portal().post(`${API}/portal/auth/forgot`).send({ email: 'nobody@example.com' });
  const known = await portal().post(`${API}/portal/auth/forgot`).send({ email: w.contact.email });
  expect([unknown.status, known.status]).toEqual([202, 202]);
  expect(unknown.body).toEqual(known.body);
  await waitFor(() => mailsTo(w.contact.email).length === 1);
  await settle();
  expect(sendMail).toHaveBeenCalledTimes(1);
  const [mail] = mailsTo(w.contact.email);
  expect(mail.html).toContain('/portal/reset?token=');

  // A contact without portal access gets nothing either.
  const other = await makeContact(w.admin, { departmentId: w.deptA.id });
  sendMail.mockClear();
  expect((await portal().post(`${API}/portal/auth/forgot`).send({ email: other.email })).status).toBe(202);
  await settle();
  expect(sendMail).not.toHaveBeenCalled();
});

it('a reset link sets a new password and ends the other open sessions', async () => {
  const open = await signedIn();
  sendMail.mockClear();
  await portal().post(`${API}/portal/auth/forgot`).send({ email: w.contact.email });
  await waitFor(() => mailsTo(w.contact.email).length === 1);
  const token = tokenIn(mailsTo(w.contact.email)[0]);
  const fresh = 'Lantern-Quay-Bridge-9';
  expectOk(await portal().post(`${API}/portal/auth/reset`).send({ token, password: fresh }));
  expect((await open.get(`${API}/portal/me`)).status).toBe(401);
  const oldPw = await portal().post(`${API}/portal/auth/login`).send({ email: w.contact.email, password: PASSWORD });
  expect(oldPw.status).toBe(401);
  expectOk(await portal().post(`${API}/portal/auth/login`).send({ email: w.contact.email, password: fresh }));
  // An invite token is no reset token.
  const inviteToken = await invite();
  const wrongKind = await portal().post(`${API}/portal/auth/reset`).send({ token: inviteToken, password: fresh });
  expect([wrongKind.status, wrongKind.body.code]).toEqual([400, 'TOKEN_INVALID']);
});

it('login is refused with portal access off, contact inactive, or portal switched off', async () => {
  await signedIn();
  const tryLogin = () => portal().post(`${API}/portal/auth/login`).send({ email: w.contact.email, password: PASSWORD });
  const wrong = await portal().post(`${API}/portal/auth/login`).send({ email: w.contact.email, password: 'Not-The-Password-1' });
  const nobody = await portal().post(`${API}/portal/auth/login`).send({ email: 'nobody@example.com', password: PASSWORD });
  expect([wrong.status, nobody.status]).toEqual([401, 401]);
  expect(wrong.body).toEqual(nobody.body);

  await models.Contact.update({ portalAccess: false }, { where: { id: w.contact.id } });
  expect((await tryLogin()).status).toBe(401);
  await models.Contact.update({ portalAccess: true, status: 'inactive' }, { where: { id: w.contact.id } });
  expect((await tryLogin()).status).toBe(401);
  await models.Contact.update({ status: 'active' }, { where: { id: w.contact.id } });
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  expect((await tryLogin()).status).toBe(403);
  const { enabled } = expectOk(await portal().get(`${API}/portal/config`));
  expect(enabled).toBe(false);
});

it('an open session ends at the next request when access is turned off', async () => {
  for (const [field, off, on] of [['portalAccess', false, true], ['status', 'inactive', 'active']]) {
    // eslint-disable-next-line no-await-in-loop
    const agent = await signedIn();
    expectOk(await agent.get(`${API}/portal/me`)); // eslint-disable-line no-await-in-loop
    await models.Contact.update({ [field]: off }, { where: { id: w.contact.id } }); // eslint-disable-line no-await-in-loop
    const res = await agent.get(`${API}/portal/me`); // eslint-disable-line no-await-in-loop
    expect([res.status, res.body.code]).toEqual([401, 'PORTAL_ACCESS_ENDED']);
    await models.Contact.update({ [field]: on }, { where: { id: w.contact.id } }); // eslint-disable-line no-await-in-loop
    // The session itself is gone, not just refused once.
    expect((await agent.get(`${API}/portal/me`)).body.code).toBe('PORTAL_UNAUTHENTICATED'); // eslint-disable-line no-await-in-loop
  }
});

it('a contact session is 401 on staff routes and a staff session is 401 on /api/v1/portal/me', async () => {
  const agent = await signedIn();
  expect((await agent.get(`${API}/tickets`)).status).toBe(401);
  expect((await agent.get(`${API}/contacts/${w.contact.id}`)).status).toBe(401);
  expect((await w.admin.agent.get(`${API}/portal/me`)).status).toBe(401);
  // Routing is case-insensitive but the portal cookie's path isn't: any
  // other letter case is refused before either session is looked at.
  expect((await w.admin.agent.get(`${API}/PORTAL/me`)).status).toBe(404);
  expect((await agent.get(`${API}/Portal/me`)).status).toBe(404);
});

it('signing out of the portal keeps the staff session', async () => {
  // One browser signed in as both.
  const both = await signedIn();
  const admin = w.admin.user;
  const staffLogin = await both.post(`${API}/auth/login`).send({ username: admin.username, password: w.admin.password });
  expect(staffLogin.status).toBe(200);
  expectOk(await both.get(`${API}/portal/me`));
  expectOk(await both.get(`${API}/auth/me`));
  expectOk(await both.post(`${API}/portal/auth/logout`));
  expect((await both.get(`${API}/portal/me`)).status).toBe(401);
  expectOk(await both.get(`${API}/auth/me`));
});

it('portal-invite needs portal.manage and respects limited company access', async () => {
  const tech = await makeTech('tess', w.deptA.id);
  const noPerm = await tech.agent.post(`${API}/contacts/${w.contact.id}/portal-invite`);
  expect(noPerm.status).toBe(403);
  expectOk(await w.admin.agent.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'portal.manage', granted: true }), 201);

  const globex = await makeCompany(w.admin, { name: 'Globex' });
  const outsider = await makeContact(w.admin, { companyId: globex.id });
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [w.contact.companyId] });
  const fenced = await tech.agent.post(`${API}/contacts/${outsider.id}/portal-invite`);
  expect(fenced.status).toBe(404);
  expect((await models.Contact.findByPk(outsider.id)).portalAccess).toBe(false);
  expectOk(await tech.agent.post(`${API}/contacts/${w.contact.id}/portal-invite`));

  // Turning portal access on or off by PATCH needs it too.
  const tech2 = await makeTech('tom', w.deptA.id);
  const patch = await tech2.agent.patch(`${API}/contacts/${w.contact.id}`).send({ portalAccess: false });
  expect(patch.status).toBe(403);
  expect((await models.Contact.findByPk(w.contact.id)).portalAccess).toBe(true);
  expectOk(await w.admin.agent.patch(`${API}/contacts/${w.contact.id}`).send({ portalAccess: false }));
  expect((await models.Contact.findByPk(w.contact.id)).portalAccess).toBe(false);
  const changed = await models.AuditLog.findOne({ where: { action: 'portal.access_changed', entityId: w.contact.id }, order: [['id', 'DESC']] });
  expect(changed.meta).toMatchObject({ portalAccess: false });

  // No email, no invite.
  const noEmail = await makeContact(w.admin, { email: null, firstName: 'Nomail' });
  const res = await w.admin.agent.post(`${API}/contacts/${noEmail.id}/portal-invite`);
  expect(res.status).toBe(400);
});

it('login is rate limited', async () => {
  const agent = portal();
  let last;
  for (let i = 0; i < 11; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await agent.post(`${API}/portal/auth/login`).send({ email: 'nobody@example.com', password: 'Wrong-Password-11' });
  }
  expect(last.status).toBe(429);
});

it('successful sign-ins don\'t use up the limit (a client office shares one IP)', async () => {
  await signedIn();
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(await portal().post(`${API}/portal/auth/login`).send({ email: w.contact.email, password: PASSWORD }));
  }
});

it('changing a contact\'s email voids their open invite and reset links', async () => {
  const token = await invite();
  expectOk(await w.admin.agent.patch(`${API}/contacts/${w.contact.id}`).send({ email: 'fixed@example.com' }));
  const res = await portal().post(`${API}/portal/auth/invite/accept`).send({ token, password: PASSWORD });
  expect([res.status, res.body.code]).toEqual([400, 'TOKEN_INVALID']);
});

it('a portal path in other letter case is refused, not half-handled', async () => {
  await signedIn();
  const res = await portal().post(`${API.toUpperCase()}/PORTAL/auth/login`).send({ email: w.contact.email, password: PASSWORD });
  expect(res.status).toBe(404);
  expect(res.headers['set-cookie']).toBeUndefined();
});

it('accepting a new invite ends the contact\'s other sessions, as a reset does', async () => {
  const open = await signedIn();
  const token = await invite();
  expectOk(await portal().post(`${API}/portal/auth/invite/accept`).send({ token, password: 'Lantern-Quay-Bridge-9' }));
  expect((await open.get(`${API}/portal/me`)).status).toBe(401);
});

it('config is public and says whether Microsoft sign-in is offered', async () => {
  const body = expectOk(await portal().get(`${API}/portal/config`));
  expect(body).toEqual({
    enabled: true, microsoft: false, branding: { appName: expect.any(String), tagline: expect.any(String), logoUrl: body.branding.logoUrl },
  });
  expect([null, '/api/v1/settings/logo']).toContain(body.branding.logoUrl);
});
