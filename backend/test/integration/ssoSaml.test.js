const request = require('supertest');
const {
  getApp, resetData, closeDb, ROLE, roleIdByName,
  SsoProvider, SsoIdentity, SsoGroupMapping, SsoAuthRequest, User, UserRole,
} = require('./helpers');
const { createSamlIdp } = require('./mockIdp');
const { callbackUrlFor } = require('../../src/controllers/ssoController');

const app = () => getApp();

let idp;
let provider;
let acsUrl;

beforeAll(() => {
  idp = createSamlIdp();
});

afterAll(closeDb);

beforeEach(async () => {
  await resetData();
  provider = await SsoProvider.create({
    name: 'SAML IdP',
    slug: 'samltest',
    protocol: 'saml',
    isEnabled: true,
    allowJit: true,
    config: JSON.stringify({
      entryPoint: 'https://idp.test/sso',
      issuer: 'prism-test-sp',
      idpCert: idp.publicKey,
      groupsAttribute: 'groups',
      // The fixture signs the assertion only, which is what most identity
      // providers do by default; the response envelope is left unsigned.
      wantAuthnResponseSigned: false,
    }),
  });
  acsUrl = callbackUrlFor(provider);
});

// Begins a login and returns the RelayState the IdP would echo back.
async function beginLogin(agent = request.agent(app())) {
  const started = await agent.get(`/api/v1/sso/${provider.slug}/start`);
  expect(started.status).toBe(302);
  const url = new URL(started.headers.location);
  const relayState = url.searchParams.get('RelayState');
  return { agent, relayState, started };
}

function assertionFor(relayState, overrides = {}) {
  return idp.buildResponse({
    subject: 'saml-user-1',
    email: 'saml.user@example.com',
    displayName: 'SAML User',
    groups: [],
    audience: 'prism-test-sp',
    destination: acsUrl,
    inResponseTo: relayState,
    ...overrides,
  });
}

async function postAssertion(agent, relayState, overrides) {
  return agent
    .post(`/api/v1/sso/${provider.slug}/acs`)
    .type('form')
    .send({ SAMLResponse: assertionFor(relayState, overrides), RelayState: relayState });
}

describe('SAML login', () => {
  it('redirects to the identity provider with a SAMLRequest and RelayState', async () => {
    const { relayState, started } = await beginLogin();
    const url = new URL(started.headers.location);
    expect(url.origin + url.pathname).toBe('https://idp.test/sso');
    expect(url.searchParams.get('SAMLRequest')).toBeTruthy();
    expect(relayState).toBeTruthy();
  });

  it('accepts a signed assertion, provisions the user and signs them in', async () => {
    const { agent, relayState } = await beginLogin();
    const res = await postAssertion(agent, relayState);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/dashboard$/);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('saml.user@example.com');

    const identity = await SsoIdentity.findOne({ where: { providerId: provider.id, subject: 'saml-user-1' } });
    expect(identity).not.toBeNull();
  });

  it('gives a provisioned user no permissions by default', async () => {
    const { agent, relayState } = await beginLogin();
    await postAssertion(agent, relayState);
    const perms = await agent.get('/api/v1/auth/me/permissions');
    expect(Object.values(perms.body.permissions).filter(Boolean)).toHaveLength(0);
  });

  // The whole security of SAML rests on the signature check.
  it('rejects an assertion signed by a different key', async () => {
    const { agent, relayState } = await beginLogin();
    const res = await postAssertion(agent, relayState, { signWith: idp.otherPrivateKey });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/ssoError=/);
    expect(await User.count({ where: { isLocalAccount: false } })).toBe(0);
  });

  it('rejects an assertion whose contents were altered after signing', async () => {
    const { agent, relayState } = await beginLogin();
    const tampered = Buffer.from(
      Buffer.from(assertionFor(relayState), 'base64')
        .toString('utf8')
        .replace('saml-user-1', 'administrator')
    ).toString('base64');

    const res = await agent
      .post(`/api/v1/sso/${provider.slug}/acs`)
      .type('form')
      .send({ SAMLResponse: tampered, RelayState: relayState });
    expect(res.headers.location).toMatch(/ssoError=/);
    expect(await User.count({ where: { isLocalAccount: false } })).toBe(0);
  });

  it('rejects an assertion for the wrong audience', async () => {
    const { agent, relayState } = await beginLogin();
    const res = await postAssertion(agent, relayState, { audience: 'some-other-service-provider' });
    expect(res.headers.location).toMatch(/ssoError=/);
  });

  it('rejects an expired assertion', async () => {
    const { agent, relayState } = await beginLogin();
    const res = await postAssertion(agent, relayState, { notOnOrAfter: new Date(Date.now() - 60_000) });
    expect(res.headers.location).toMatch(/ssoError=/);
  });

  it('rejects a replayed RelayState', async () => {
    const { agent, relayState } = await beginLogin();
    await postAssertion(agent, relayState);
    const replay = await postAssertion(agent, relayState);
    expect(replay.headers.location).toMatch(/ssoError=/);
  });

  it('rejects an assertion with no RelayState at all', async () => {
    const { agent, relayState } = await beginLogin();
    const res = await agent
      .post(`/api/v1/sso/${provider.slug}/acs`)
      .type('form')
      .send({ SAMLResponse: assertionFor(relayState) });
    expect(res.headers.location).toMatch(/ssoError=/);
  });

  it('rejects an expired login request', async () => {
    const { agent, relayState } = await beginLogin();
    await SsoAuthRequest.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { state: relayState } });
    const res = await postAssertion(agent, relayState);
    expect(res.headers.location).toMatch(/ssoError=/);
  });

  it('refuses a subject with no account when JIT provisioning is disabled', async () => {
    await provider.update({ allowJit: false });
    const { agent, relayState } = await beginLogin();
    const res = await postAssertion(agent, relayState);
    expect(res.headers.location).toMatch(/ssoError=/);
    expect(await User.count({ where: { isLocalAccount: false } })).toBe(0);
  });
});

describe('SAML group mapping', () => {
  it('grants and later revokes a mapped role as the assertion changes', async () => {
    const technicianId = await roleIdByName(ROLE.TECHNICIAN);
    await SsoGroupMapping.create({ providerId: provider.id, claimValue: 'prism-techs', roleId: technicianId });

    let { agent, relayState } = await beginLogin();
    await postAssertion(agent, relayState, { groups: ['prism-techs'] });
    let perms = await agent.get('/api/v1/auth/me/permissions');
    expect(perms.body.permissions['tickets.view_all']).toBe(true);

    ({ agent, relayState } = await beginLogin());
    await postAssertion(agent, relayState, { groups: [] });
    perms = await agent.get('/api/v1/auth/me/permissions');
    expect(perms.body.permissions['tickets.view_all']).toBeFalsy();

    const user = await User.findOne({ where: { isLocalAccount: false } });
    expect(await UserRole.count({ where: { userId: user.id, roleId: technicianId } })).toBe(0);
  });
});

describe('SAML service provider metadata', () => {
  it('serves metadata an administrator can hand to their IdP', async () => {
    const res = await request(app()).get(`/api/v1/sso/${provider.slug}/metadata`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toMatch(/EntityDescriptor/);
    expect(res.text).toContain(acsUrl);
  });

  it('is not served for an OIDC provider', async () => {
    const oidcProvider = await SsoProvider.create({
      name: 'OIDC', slug: 'oidconly', protocol: 'oidc', isEnabled: true,
      config: JSON.stringify({ issuerUrl: 'https://issuer.test', clientId: 'x' }),
    });
    const res = await request(app()).get(`/api/v1/sso/${oidcProvider.slug}/metadata`);
    expect(res.status).toBe(404);
  });
});
