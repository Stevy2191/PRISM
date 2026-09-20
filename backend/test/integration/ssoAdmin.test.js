const request = require('supertest');
const {
  getApp, createUserAndLogin, resetData, closeDb, ROLE, roleIdByName,
  SsoProvider, SsoGroupMapping, User, models,
} = require('./helpers');

const app = () => getApp();
const { SystemSettings } = models;

let admin;
let plainUser;

beforeEach(async () => {
  await resetData();
  admin = await createUserAndLogin({ username: 'boss', roleName: ROLE.ADMIN, legacyRole: 'admin' });
  plainUser = await createUserAndLogin({ username: 'tech', roleName: ROLE.TECHNICIAN });
});

afterAll(closeDb);

const oidcBody = (overrides = {}) => ({
  name: 'Entra', slug: 'entra', protocol: 'oidc',
  config: { issuerUrl: 'https://login.example.com/v2.0', clientId: 'abc' },
  clientSecret: 'super-secret-value',
  ...overrides,
});

describe('provider administration', () => {
  it('requires settings.manage_system', async () => {
    const res = await plainUser.agent.get('/api/v1/sso-admin/providers');
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app()).get('/api/v1/sso-admin/providers');
    expect(res.status).toBe(401);
  });

  it('creates a provider and reports its callback URL', async () => {
    const res = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    expect(res.status).toBe(201);
    expect(res.body.provider.callbackUrl).toMatch(/\/api\/v1\/sso\/entra\/callback$/);
  });

  // The secret is write-only: the settings UI shows whether one is set, never
  // the value, matching how the LDAP bind password is handled.
  it('never returns a stored client secret', async () => {
    await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    const list = await admin.agent.get('/api/v1/sso-admin/providers');
    expect(JSON.stringify(list.body)).not.toContain('super-secret-value');
    expect(list.body.providers[0].hasClientSecret).toBe(true);
  });

  it('stores the client secret encrypted rather than in the clear', async () => {
    await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    const row = await SsoProvider.findOne({ where: { slug: 'entra' } });
    expect(row.clientSecret).not.toContain('super-secret-value');
    const { decryptToken } = require('../../src/utils/tokenCrypto');
    expect(decryptToken(row.clientSecret)).toBe('super-secret-value');
  });

  it('keeps the existing secret when none is supplied on update', async () => {
    const created = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    await admin.agent.patch(`/api/v1/sso-admin/providers/${created.body.provider.id}`)
      .send({ name: 'Entra ID' });
    const row = await SsoProvider.findByPk(created.body.provider.id);
    const { decryptToken } = require('../../src/utils/tokenCrypto');
    expect(decryptToken(row.clientSecret)).toBe('super-secret-value');
  });

  it.each([
    ['a leading hyphen', '-bad'],
    ['spaces', 'bad slug'],
    ['a path traversal attempt', '../admin'],
    ['a slash', 'bad/slug'],
  ])('rejects %s as a slug', async (_label, slug) => {
    const res = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody({ slug }));
    expect(res.status).toBe(400);
  });

  // Uppercase is normalized rather than rejected — the result is still a
  // valid, unique slug, and rejecting it would only be annoying.
  it('lowercases a slug rather than rejecting it', async () => {
    const res = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody({ slug: 'Entra-ID' }));
    expect(res.status).toBe(201);
    expect(res.body.provider.slug).toBe('entra-id');
  });

  it('rejects a duplicate slug', async () => {
    await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    const res = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody({ name: 'Second' }));
    expect(res.status).toBe(409);
  });

  it('rejects an unknown protocol', async () => {
    const res = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody({ protocol: 'ws-fed' }));
    expect(res.status).toBe(400);
  });

  // Config is allow-listed per protocol: an admin must not be able to smuggle
  // in a flag the adapter treats as trusted, such as disabling signature
  // checks on a SAML provider.
  it('discards configuration keys outside the protocol allow-list', async () => {
    const res = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody({
      config: { issuerUrl: 'https://login.example.com/v2.0', clientId: 'abc', wantAssertionsSigned: false },
    }));
    expect(res.status).toBe(201);
    const row = await SsoProvider.findOne({ where: { slug: 'entra' } });
    expect(row.parsedConfig().wantAssertionsSigned).toBeUndefined();
  });

  it('deletes a provider and reports how many identities were unlinked', async () => {
    const created = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    const res = await admin.agent.delete(`/api/v1/sso-admin/providers/${created.body.provider.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('unlinkedIdentities');
    expect(await SsoProvider.count()).toBe(0);
  });
});

describe('group mapping administration', () => {
  let providerId;

  beforeEach(async () => {
    const created = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody());
    providerId = created.body.provider.id;
  });

  it('creates and lists a mapping', async () => {
    const roleId = await roleIdByName(ROLE.TECHNICIAN);
    const created = await admin.agent.post(`/api/v1/sso-admin/providers/${providerId}/mappings`)
      .send({ claimValue: 'prism-techs', roleId });
    expect(created.status).toBe(201);

    const list = await admin.agent.get(`/api/v1/sso-admin/providers/${providerId}/mappings`);
    expect(list.body.mappings).toHaveLength(1);
  });

  it('rejects a mapping to a role that does not exist', async () => {
    const res = await admin.agent.post(`/api/v1/sso-admin/providers/${providerId}/mappings`)
      .send({ claimValue: 'x', roleId: 999999 });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate claim value for the same provider', async () => {
    const roleId = await roleIdByName(ROLE.TECHNICIAN);
    await admin.agent.post(`/api/v1/sso-admin/providers/${providerId}/mappings`).send({ claimValue: 'dup', roleId });
    const res = await admin.agent.post(`/api/v1/sso-admin/providers/${providerId}/mappings`).send({ claimValue: 'dup', roleId });
    expect(res.status).toBe(409);
  });

  it('deletes a mapping', async () => {
    const roleId = await roleIdByName(ROLE.TECHNICIAN);
    const created = await admin.agent.post(`/api/v1/sso-admin/providers/${providerId}/mappings`)
      .send({ claimValue: 'gone', roleId });
    const res = await admin.agent
      .delete(`/api/v1/sso-admin/providers/${providerId}/mappings/${created.body.mapping.id}`);
    expect(res.status).toBe(200);
    expect(await SsoGroupMapping.count()).toBe(0);
  });
});

describe('SSO-only enforcement', () => {
  async function enableProvider() {
    const created = await admin.agent.post('/api/v1/sso-admin/providers').send(oidcBody({ isEnabled: true }));
    return created.body.provider.id;
  }

  // Requiring SSO with no way back in is how an organisation loses access to
  // its own helpdesk when an identity provider misbehaves.
  it('refuses to require SSO with no break-glass account', async () => {
    await enableProvider();
    const res = await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_BREAK_GLASS');
  });

  it('refuses to require SSO with no enabled provider', async () => {
    await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: true });
    const res = await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_SSO_PROVIDER');
  });

  it('allows enforcement once a provider and a break-glass account exist', async () => {
    await enableProvider();
    await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: true });
    const res = await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.ssoOnly).toBe(true);
  });

  it('blocks password login for ordinary accounts once enforced', async () => {
    await enableProvider();
    await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: true });
    await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });

    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'tech', password: 'IntegrationPass!2026' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SSO_REQUIRED');
  });

  it('still lets a break-glass account in', async () => {
    await enableProvider();
    await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: true });
    await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });

    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'boss', password: 'IntegrationPass!2026' });
    expect(res.status).toBe(200);
  });

  // The wrong password must look the same whether or not the account holds
  // the exemption, or the error becomes a way to find the break-glass account.
  it('does not reveal break-glass status through the error for a wrong password', async () => {
    await enableProvider();
    await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: true });
    await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });

    const exempt = await request(app()).post('/api/v1/auth/login').send({ username: 'boss', password: 'WrongPassword!1' });
    const ordinary = await request(app()).post('/api/v1/auth/login').send({ username: 'tech', password: 'WrongPassword!1' });
    expect(exempt.status).toBe(401);
    expect(ordinary.status).toBe(401);
    expect(exempt.body.code).toBe(ordinary.body.code);
  });

  it('refuses to make a directory account break-glass', async () => {
    const directoryUser = await User.create({
      username: 'aduser', displayName: 'AD User', role: 'technician',
      isLocalAccount: false, isActive: true, passwordHash: null,
    });
    const res = await admin.agent.put(`/api/v1/sso-admin/break-glass/${directoryUser.id}`).send({ isBreakGlass: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_LOCAL_ACCOUNT');
  });

  it('refuses to remove the last break-glass account while SSO is required', async () => {
    await enableProvider();
    await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: true });
    await admin.agent.put('/api/v1/sso-admin/enforcement').send({ ssoOnly: true });

    const res = await admin.agent.put(`/api/v1/sso-admin/break-glass/${admin.user.id}`).send({ isBreakGlass: false });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LAST_BREAK_GLASS');
  });

  it('leaves password login alone when enforcement is off', async () => {
    await SystemSettings.upsert({ key: 'sso.enforced', value: 'false' });
    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'tech', password: 'IntegrationPass!2026' });
    expect(res.status).toBe(200);
  });
});
