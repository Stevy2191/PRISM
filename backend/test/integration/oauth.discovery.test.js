const request = require('supertest');
const {
  getApp, resetData, closeDb, models,
} = require('./helpers');
const { resolveClient } = require('../../src/services/oauth/clients');

// MCP-O 2: how Claude finds PRISM's sign-in (RFC 9728, RFC 8414) and how an
// app becomes a client: registered automatically (RFC 7591) or described by
// a client ID metadata document fetched only from allowed domains.

const app = () => getApp();
const ISSUER = 'https://help.example.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const setSetting = (key, value) => models.SystemSettings.upsert({ key, value });
const enable = () => setSetting('mcp.enabled', 'true');

let savedUrl;
let savedFetch;
beforeAll(() => { savedUrl = process.env.PUBLIC_APP_URL; process.env.PUBLIC_APP_URL = `${ISSUER}/`; });
afterAll(async () => {
  if (savedUrl === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = savedUrl;
  await closeDb();
});
beforeEach(async () => { await resetData(); savedFetch = global.fetch; });
afterEach(() => { global.fetch = savedFetch; });

describe('while it is off (the default)', () => {
  it('nothing is advertised and nobody can register', async () => {
    expect((await request(app()).get('/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await request(app()).get('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
    expect((await request(app()).post('/api/v1/oauth/register').send({ redirect_uris: [CALLBACK] })).status).toBe(404);
  });
});

describe('once an Owner turns it on', () => {
  beforeEach(enable);

  it('advertises the authorization server (RFC 8414)', async () => {
    const res = await request(app()).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/api/v1/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/v1/oauth/token`,
      registration_endpoint: `${ISSUER}/api/v1/oauth/register`,
      revocation_endpoint: `${ISSUER}/api/v1/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['prism'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('advertises the protected resource at both well-known paths (RFC 9728)', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app()).get(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect(res.body).toEqual({
        resource: `${ISSUER}/mcp`,
        authorization_servers: [ISSUER],
        scopes_supported: ['prism'],
        bearer_methods_supported: ['header'],
        resource_name: 'PRISM',
      });
    }
  });

  it('registers a public client whose redirect is on an allowed domain', async () => {
    const res = await request(app()).post('/api/v1/oauth/register').send({ client_name: 'Claude', redirect_uris: [CALLBACK] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(res.body.client_id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.client_secret).toBeUndefined();
    const row = await models.OAuthClient.findOne({ where: { clientId: res.body.client_id } });
    expect(row.kind).toBe('dcr');
    expect(await models.AuditLog.count({ where: { action: 'oauth.client.register' } })).toBe(1);
  });

  it('a local app (Claude Code) may use an http localhost redirect', async () => {
    const res = await request(app()).post('/api/v1/oauth/register').send({ client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'] });
    expect(res.status).toBe(201);
  });

  it('refuses redirects elsewhere, plain http, and clients that want a secret', async () => {
    const reg = (body) => request(app()).post('/api/v1/oauth/register').send(body);
    for (const uris of [['https://evil.test/cb'], ['http://claude.ai/cb'], [CALLBACK, 'https://claude.ai.evil.test/cb'], [], ['not a url']]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await reg({ client_name: 'X', redirect_uris: uris });
      expect([uris, res.status, res.body.error]).toEqual([uris, 400, 'invalid_redirect_uri']);
    }
    const secret = await reg({ client_name: 'X', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' });
    expect([secret.status, secret.body.error]).toEqual([400, 'invalid_client_metadata']);
  });

  it('subdomains of an allowed domain count; the admin can narrow the list', async () => {
    const reg = (uri) => request(app()).post('/api/v1/oauth/register').send({ client_name: 'X', redirect_uris: [uri] });
    expect((await reg('https://app.claude.ai/cb')).status).toBe(201);
    await setSetting('mcp.allowedDomains', 'claude.ai');
    expect((await reg('https://claude.com/cb')).status).toBe(400);
  });
});

describe('client ID metadata documents', () => {
  beforeEach(enable);

  const doc = (url, extra = {}) => ({ client_id: url, client_name: 'Claude', redirect_uris: [CALLBACK], ...extra });
  const stubFetch = (body) => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return calls;
  };

  it('fetches a document on an allowed domain and keeps it', async () => {
    const url = 'https://claude.ai/oauth/mcp-client.json';
    const calls = stubFetch(doc(url));
    const client = await resolveClient(url);
    expect(client).toMatchObject({ clientId: url, kind: 'cimd', name: 'Claude', redirectUris: [CALLBACK] });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.redirect).toBe('error');
    await resolveClient(url);
    expect(calls).toHaveLength(1); // cached for a day
  });

  it('never fetches from a domain that is not allowed, or over plain http', async () => {
    const calls = stubFetch({});
    expect(await resolveClient('https://evil.test/client.json')).toBeNull();
    expect(await resolveClient('http://claude.ai/client.json')).toBeNull();
    expect(await resolveClient('https://claude.ai.evil.test/client.json')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('refuses a document that names a different client, or redirects off the allowed domains', async () => {
    const url = 'https://claude.ai/oauth/mcp-client.json';
    stubFetch(doc('https://claude.ai/other.json'));
    expect(await resolveClient(url)).toBeNull();
    stubFetch(doc(url, { redirect_uris: ['https://evil.test/cb'] }));
    expect(await resolveClient(url)).toBeNull();
    expect(await models.OAuthClient.count()).toBe(0);
  });

  it('an unknown plain client id is no client', async () => {
    expect(await resolveClient('no-such-client')).toBeNull();
  });
});
