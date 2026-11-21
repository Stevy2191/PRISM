const request = require('supertest');
const {
  getApp, createUserAndLogin, resetData, closeDb, models, ROLE,
} = require('./helpers');
const {
  ISSUER, RESOURCE, CALLBACK, enable, withIssuer, pkce, register, authorize, consentId, authorizeParams, decide, token, connect,
} = require('./oauthHelpers');

// MCP-O 3: authorize → consent → code → tokens → refresh → revoke.

const app = () => getApp();
withIssuer();
let tech;
beforeEach(async () => {
  await resetData();
  await enable();
  tech = await createUserAndLogin({ username: 'tina', roleName: ROLE.TECHNICIAN });
});
afterAll(closeDb);

describe('authorize', () => {
  it('sends the person to the consent page, which describes the request', async () => {
    const clientId = await register();
    const loc = await authorize(authorizeParams(clientId, pkce()));
    expect(`${loc.origin}${loc.pathname}`).toMatch(new RegExp(`^${ISSUER}/oauth/consent/[A-Za-z0-9_-]{30,}$`));
    const res = await tech.agent.get(`/api/v1/oauth/requests/${consentId(loc)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ client: { name: 'Claude' }, redirectHost: 'claude.ai', user: { username: 'tina' }, allowWrites: false });
  });

  it('a bad request after the redirect is known goes back to the app with an error', async () => {
    const clientId = await register();
    const p = pkce();
    for (const [extra, error] of [
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.test/mcp' }, 'invalid_target'],
      [{ scope: 'admin' }, 'invalid_scope'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const loc = await authorize(authorizeParams(clientId, p, extra));
      expect([extra, `${loc.origin}${loc.pathname}`, loc.searchParams.get('error'), loc.searchParams.get('state'), loc.searchParams.get('iss')])
        .toEqual([extra, CALLBACK, error, 'xyz-state', ISSUER]);
    }
  });

  it('an unknown app or a redirect it never registered is never redirected to', async () => {
    const clientId = await register();
    const p = pkce();
    for (const params of [authorizeParams('no-such-app', p), authorizeParams(clientId, p, { redirect_uri: 'https://claude.ai/elsewhere' })]) {
      // eslint-disable-next-line no-await-in-loop
      const loc = await authorize(params);
      expect(`${loc.origin}${loc.pathname}`).toBe(`${ISSUER}/oauth/consent/error`);
    }
  });

  it('a missing resource means /mcp; a trailing slash is the same resource', async () => {
    const clientId = await register();
    const p = pkce();
    const loc1 = await authorize(authorizeParams(clientId, p, { resource: undefined }));
    const loc2 = await authorize(authorizeParams(clientId, p, { resource: `${RESOURCE}/` }));
    expect(loc1.pathname).toMatch(/^\/oauth\/consent\/[^/]+$/);
    expect(loc2.pathname).toMatch(/^\/oauth\/consent\/[^/]+$/);
  });

  it('only a signed-in staff session sees or answers a consent (not an API key, not nobody)', async () => {
    const clientId = await register();
    const id = consentId(await authorize(authorizeParams(clientId, pkce())));
    expect((await request(app()).get(`/api/v1/oauth/requests/${id}`)).status).toBe(401);
    const { key } = (await tech.agent.post('/api/v1/apikeys').send({ name: 'k' })).body;
    expect((await request(app()).get(`/api/v1/oauth/requests/${id}`).set('X-API-Key', key)).status).toBe(403);
    expect((await request(app()).post(`/api/v1/oauth/requests/${id}/decision`).set('X-API-Key', key).send({ allow: true })).status).toBe(403);
    expect((await tech.agent.get('/api/v1/oauth/requests/nope')).status).toBe(404);
  });
});

describe('consent and the code', () => {
  it('allow → code, state and iss back to the app → tokens', async () => {
    const t = await connect(tech.agent);
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'prism' });
    expect(t.access_token).toMatch(/^prism_oat_[0-9a-f]{64}$/);
    expect(t.refresh_token).toMatch(/^prism_ort_[0-9a-f]{64}$/);
    const conn = await models.OAuthConnection.findOne();
    expect(conn).toMatchObject({ userId: tech.user.id, resource: RESOURCE, scope: 'prism', revokedAt: null });
    expect(conn.accessHash).not.toContain(t.access_token.slice(10));
    expect(await models.AuditLog.count({ where: { action: 'oauth.connect', userId: tech.user.id } })).toBe(1);
  });

  it('the redirect carries the code with the original state and the issuer', async () => {
    const clientId = await register();
    const back = await decide(tech.agent, consentId(await authorize(authorizeParams(clientId, pkce()))));
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK);
    expect(back.searchParams.get('code')).toBeTruthy();
    expect(back.searchParams.get('state')).toBe('xyz-state');
    expect(back.searchParams.get('iss')).toBe(ISSUER);
  });

  it('deny goes back with access_denied and connects nothing', async () => {
    const clientId = await register();
    const back = await decide(tech.agent, consentId(await authorize(authorizeParams(clientId, pkce()))), false);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
    expect(await models.OAuthConnection.count()).toBe(0);
    expect(await models.AuditLog.count({ where: { action: 'oauth.deny' } })).toBe(1);
  });

  it('a consent can be answered once', async () => {
    const clientId = await register();
    const id = consentId(await authorize(authorizeParams(clientId, pkce())));
    await decide(tech.agent, id);
    expect((await tech.agent.post(`/api/v1/oauth/requests/${id}/decision`).send({ allow: true })).status).toBe(404);
  });

  it('the code needs the right verifier, client and redirect, works once, and expires', async () => {
    const clientId = await register();
    const p = pkce();
    const fresh = async () => (await decide(tech.agent, consentId(await authorize(authorizeParams(clientId, p))))).searchParams.get('code');
    const exchange = (code, extra = {}) => token({
      grant_type: 'authorization_code', code, redirect_uri: CALLBACK, code_verifier: p.verifier, client_id: clientId, ...extra,
    });

    let code = await fresh();
    expect((await exchange(code, { code_verifier: pkce().verifier })).body.error).toBe('invalid_grant');
    code = await fresh();
    expect((await exchange(code, { redirect_uri: 'https://claude.ai/other' })).body.error).toBe('invalid_grant');
    code = await fresh();
    expect((await exchange(code, { client_id: await register() })).body.error).toBe('invalid_grant');

    code = await fresh();
    expect((await exchange(code)).status).toBe(200);
    const again = await exchange(code);
    expect([again.status, again.body.error]).toEqual([400, 'invalid_grant']);

    code = await fresh();
    await models.OAuthRequest.update({ expiresAt: new Date(Date.now() - 1000) }, { where: {} });
    expect((await exchange(code)).body.error).toBe('invalid_grant');
  });

  it('token errors are OAuth errors and are never cached', async () => {
    const res = await token({ grant_type: 'password', username: 'a', password: 'b' });
    expect([res.status, res.body.error]).toEqual([400, 'unsupported_grant_type']);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('refresh and revoke', () => {
  const refresh = (t, extra = {}) => token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId, ...extra });

  it('a refresh gives a new pair and retires the old access token', async () => {
    const first = await connect(tech.agent);
    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(res.body.access_token).not.toBe(first.access_token);
    expect(res.body.refresh_token).not.toBe(first.refresh_token);
    const conn = await models.OAuthConnection.findOne();
    const { sha256 } = require('../../src/services/oauth/tokens'); // eslint-disable-line global-require
    expect(conn.accessHash).toBe(sha256(res.body.access_token));
    expect(await models.OAuthConnection.count()).toBe(1);
  });

  it('refresh reuse revokes: a stolen, already-used refresh token kills the connection', async () => {
    const first = await connect(tech.agent);
    const second = (await refresh(first)).body;
    const replay = await refresh(first);
    expect([replay.status, replay.body.error]).toEqual([400, 'invalid_grant']);
    const conn = await models.OAuthConnection.findOne();
    expect(conn.revokedAt).not.toBeNull();
    expect(conn.revokedReason).toBe('refresh_reuse');
    expect((await refresh({ ...second, clientId: first.clientId })).body.error).toBe('invalid_grant');
    expect(await models.AuditLog.count({ where: { action: 'oauth.revoke' } })).toBe(1);
  });

  it('refresh needs the same client, and fails once the user is deactivated', async () => {
    const first = await connect(tech.agent);
    expect((await refresh(first, { client_id: await register() })).body.error).toBe('invalid_grant');
    await models.User.update({ isActive: false }, { where: { id: tech.user.id } });
    expect((await refresh(first)).body.error).toBe('invalid_grant');
  });

  it('revoking a refresh token ends the connection; an unknown token is fine (RFC 7009)', async () => {
    const first = await connect(tech.agent);
    const res = await request(app()).post('/api/v1/oauth/revoke').type('form').send({ token: first.refresh_token, client_id: first.clientId });
    expect(res.status).toBe(200);
    expect((await models.OAuthConnection.findOne()).revokedAt).not.toBeNull();
    expect((await refresh(first)).body.error).toBe('invalid_grant');
    expect((await request(app()).post('/api/v1/oauth/revoke').type('form').send({ token: 'prism_ort_nope' })).status).toBe(200);
  });
});
