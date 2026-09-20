const request = require('supertest');
const {
  getApp, resetData, closeDb, ROLE, roleIdByName,
  SsoProvider, SsoIdentity, SsoGroupMapping, SsoAuthRequest, User, UserRole,
} = require('./helpers');
const { startOidcIdp } = require('./mockIdp');
const { clearDiscoveryCache } = require('../../src/services/sso/oidc');

const app = () => getApp();

let idp;
let provider;

beforeAll(async () => {
  idp = await startOidcIdp();
});

afterAll(async () => {
  await idp.close();
  await closeDb();
});

beforeEach(async () => {
  await resetData();
  clearDiscoveryCache();
  idp.replaceProfile({ sub: 'user-1', email: 'user@example.com', name: 'Test User', groups: [] });
  provider = await SsoProvider.create({
    name: 'Test IdP',
    slug: 'testidp',
    protocol: 'oidc',
    isEnabled: true,
    allowJit: true,
    config: JSON.stringify({
      issuerUrl: idp.issuer,
      clientId: idp.clientId,
      groupsClaim: 'groups',
      // The mock issuer is plain http on loopback; production issuers must be
      // https, which is enforced unless a provider opts in like this.
      allowInsecureIssuer: true,
    }),
    clientSecret: require('../../src/utils/tokenCrypto').encryptToken(idp.clientSecret),
  });
});

// Drives a full login: hit /start, follow the redirect's state, then call the
// callback the way the IdP's browser redirect would.
async function completeLogin({ agent = request.agent(app()), returnTo } = {}) {
  const startUrl = `/api/v1/sso/${provider.slug}/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  const started = await agent.get(startUrl);
  const redirect = new URL(started.headers.location);
  const state = redirect.searchParams.get('state');
  const nonce = redirect.searchParams.get('nonce');
  idp.setNonce(nonce);
  const callback = await agent.get(`/api/v1/sso/${provider.slug}/callback?code=test-code&state=${encodeURIComponent(state)}`);
  return { agent, started, state, callback };
}

describe('GET /sso/providers', () => {
  it('lists enabled providers without leaking configuration', async () => {
    const res = await request(app()).get('/api/v1/sso/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(1);
    expect(res.body.providers[0].slug).toBe('testidp');
    expect(JSON.stringify(res.body)).not.toMatch(/clientSecret|test-secret|issuerUrl/);
  });

  it('omits disabled providers', async () => {
    await provider.update({ isEnabled: false });
    const res = await request(app()).get('/api/v1/sso/providers');
    expect(res.body.providers).toHaveLength(0);
  });
});

describe('OIDC login', () => {
  it('redirects to the identity provider with PKCE, state and nonce', async () => {
    const res = await request(app()).get(`/api/v1/sso/${provider.slug}/start`);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin).toBe(idp.issuer);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
  });

  it('provisions a new user and signs them in', async () => {
    const { agent, callback } = await completeLogin();
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(/\/dashboard$/);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('user@example.com');

    const identity = await SsoIdentity.findOne({ where: { providerId: provider.id, subject: 'user-1' } });
    expect(identity).not.toBeNull();
  });

  // Matching the fail-closed behaviour of directory provisioning: an account
  // exists, but it can do nothing until somebody grants it something.
  it('gives a provisioned user no permissions by default', async () => {
    const { agent } = await completeLogin();
    const perms = await agent.get('/api/v1/auth/me/permissions');
    const granted = Object.entries(perms.body.permissions).filter(([, v]) => v);
    expect(granted).toHaveLength(0);
  });

  it('reuses the existing account on a second login rather than duplicating it', async () => {
    await completeLogin();
    await completeLogin();
    expect(await SsoIdentity.count({ where: { providerId: provider.id } })).toBe(1);
    expect(await User.count({ where: { isLocalAccount: false } })).toBe(1);
  });

  it('refuses a subject with no account when JIT provisioning is disabled', async () => {
    await provider.update({ allowJit: false });
    const { callback } = await completeLogin();
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(/ssoError=/);
    expect(await User.count({ where: { isLocalAccount: false } })).toBe(0);
  });

  it('refuses a deactivated account', async () => {
    await completeLogin();
    await User.update({ isActive: false }, { where: { isLocalAccount: false } });
    const { callback } = await completeLogin();
    expect(callback.headers.location).toMatch(/ssoError=/);
  });

  it('regenerates the session, so a pre-login session id cannot be reused', async () => {
    const agent = request.agent(app());
    // Establish a session id before authenticating.
    await agent.get('/api/v1/sso/providers');
    const { callback } = await completeLogin({ agent });
    const issued = callback.headers['set-cookie']?.find((c) => c.startsWith('prism.sid'));
    expect(issued).toBeDefined();
  });
});

describe('OIDC login state', () => {
  it('rejects a replayed state value', async () => {
    const { state } = await completeLogin();
    const replay = await request(app())
      .get(`/api/v1/sso/${provider.slug}/callback?code=test-code&state=${encodeURIComponent(state)}`);
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toMatch(/ssoError=/);
  });

  it('rejects an unknown state value', async () => {
    const res = await request(app())
      .get(`/api/v1/sso/${provider.slug}/callback?code=test-code&state=not-a-real-state`);
    expect(res.headers.location).toMatch(/ssoError=/);
  });

  it('rejects an expired state value', async () => {
    const started = await request(app()).get(`/api/v1/sso/${provider.slug}/start`);
    const state = new URL(started.headers.location).searchParams.get('state');
    await SsoAuthRequest.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { state } });

    const res = await request(app())
      .get(`/api/v1/sso/${provider.slug}/callback?code=test-code&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toMatch(/ssoError=/);
  });

  it('rejects a state issued for a different provider', async () => {
    const other = await SsoProvider.create({
      name: 'Other', slug: 'other', protocol: 'oidc', isEnabled: true,
      config: JSON.stringify({ issuerUrl: idp.issuer, clientId: idp.clientId, allowInsecureIssuer: true }),
    });
    const started = await request(app()).get(`/api/v1/sso/${other.slug}/start`);
    const state = new URL(started.headers.location).searchParams.get('state');

    const res = await request(app())
      .get(`/api/v1/sso/${provider.slug}/callback?code=test-code&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toMatch(/ssoError=/);
  });
});

describe('OIDC return path', () => {
  it('honours a same-site return path', async () => {
    const { callback } = await completeLogin({ returnTo: '/tickets/42' });
    expect(callback.headers.location).toMatch(/\/tickets\/42$/);
  });

  // The callback is the one place an unauthenticated caller controls a
  // redirect target, so it must not be usable to bounce users off-site.
  it.each(['https://evil.test/phish', '//evil.test/phish', '/\\evil.test'])(
    'refuses to redirect to %s',
    async (target) => {
      const { callback } = await completeLogin({ returnTo: target });
      expect(callback.headers.location).not.toMatch(/evil\.test/);
      expect(callback.headers.location).toMatch(/\/dashboard$/);
    }
  );
});

describe('OIDC group mapping', () => {
  let technicianId;

  beforeEach(async () => {
    technicianId = await roleIdByName(ROLE.TECHNICIAN);
    await SsoGroupMapping.create({ providerId: provider.id, claimValue: 'prism-techs', roleId: technicianId });
  });

  it('grants a mapped role when the claim is asserted', async () => {
    idp.setProfile({ groups: ['prism-techs'] });
    const { agent } = await completeLogin();
    const perms = await agent.get('/api/v1/auth/me/permissions');
    expect(perms.body.permissions['tickets.view_all']).toBe(true);
  });

  it('grants nothing when the claim is absent', async () => {
    idp.setProfile({ groups: ['some-other-group'] });
    const { agent } = await completeLogin();
    const perms = await agent.get('/api/v1/auth/me/permissions');
    expect(perms.body.permissions['tickets.view_all']).toBeFalsy();
  });

  // Revoking in the IdP has to actually revoke here, or group mapping is
  // worse than useless — it looks like access control but only ever grants.
  it('removes a mapped role once the claim stops being asserted', async () => {
    idp.setProfile({ groups: ['prism-techs'] });
    await completeLogin();
    const user = await User.findOne({ where: { isLocalAccount: false } });
    expect(await UserRole.count({ where: { userId: user.id, roleId: technicianId } })).toBe(1);

    idp.setProfile({ groups: [] });
    const { agent } = await completeLogin();
    expect(await UserRole.count({ where: { userId: user.id, roleId: technicianId } })).toBe(0);

    const perms = await agent.get('/api/v1/auth/me/permissions');
    expect(perms.body.permissions['tickets.view_all']).toBeFalsy();
  });

  // A role an administrator granted by hand is not this provider's to remove.
  it('leaves roles it does not manage alone', async () => {
    const readOnlyId = await roleIdByName(ROLE.READ_ONLY);
    idp.setProfile({ groups: ['prism-techs'] });
    await completeLogin();
    const user = await User.findOne({ where: { isLocalAccount: false } });
    await UserRole.create({ userId: user.id, roleId: readOnlyId, assignedAt: new Date() });

    idp.setProfile({ groups: [] });
    await completeLogin();
    expect(await UserRole.count({ where: { userId: user.id, roleId: readOnlyId } })).toBe(1);
  });

  it('falls back to the provider default role when nothing matches', async () => {
    const readOnlyId = await roleIdByName(ROLE.READ_ONLY);
    await provider.update({ defaultRoleId: readOnlyId });
    idp.setProfile({ groups: [] });
    const { agent } = await completeLogin();
    const perms = await agent.get('/api/v1/auth/me/permissions');
    expect(perms.body.permissions['tickets.view_department']).toBe(true);
  });
});
