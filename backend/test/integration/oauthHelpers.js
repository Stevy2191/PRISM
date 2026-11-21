// Shared by the MCP-O tests: turn Claude connections on, and run the whole
// sign-in (register → authorize → consent → token) the way claude.ai does.
const crypto = require('crypto');
const request = require('supertest');
const { getApp, models } = require('./helpers');

const ISSUER = 'https://help.example.test';
const RESOURCE = `${ISSUER}/mcp`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const app = () => getApp();

const setSetting = (key, value) => models.SystemSettings.upsert({ key, value });
const enable = async ({ writes = false } = {}) => {
  await setSetting('mcp.enabled', 'true');
  await setSetting('mcp.allowWrites', writes ? 'true' : 'false');
};

function withIssuer() {
  let saved;
  beforeAll(() => { saved = process.env.PUBLIC_APP_URL; process.env.PUBLIC_APP_URL = ISSUER; });
  afterAll(() => { if (saved === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = saved; });
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

async function register(redirect = CALLBACK) {
  const res = await request(app()).post('/api/v1/oauth/register').send({ client_name: 'Claude', redirect_uris: [redirect] });
  if (res.status !== 201) throw new Error(`register → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.client_id;
}

// GET /authorize; returns the Location it redirects to, parsed.
async function authorize(params) {
  const res = await request(app()).get('/api/v1/oauth/authorize').query(params);
  if (res.status !== 302) throw new Error(`authorize → ${res.status} ${JSON.stringify(res.body)}`);
  return new URL(res.headers.location);
}

const consentId = (location) => location.pathname.split('/').pop();

function authorizeParams(clientId, { challenge }, extra = {}) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz-state',
    scope: 'prism',
    resource: RESOURCE,
    ...extra,
  };
}

async function decide(agent, id, allow = true) {
  const res = await agent.post(`/api/v1/oauth/requests/${id}/decision`).send({ allow });
  if (res.status !== 200) throw new Error(`decision → ${res.status} ${JSON.stringify(res.body)}`);
  return new URL(res.body.redirectTo);
}

function token(form) {
  return request(app()).post('/api/v1/oauth/token').type('form').send(form);
}

// The whole thing for a signed-in staff `agent`: returns the token response.
async function connect(agent) {
  const clientId = await register();
  const p = pkce();
  const loc = await authorize(authorizeParams(clientId, p));
  const back = await decide(agent, consentId(loc));
  const res = await token({
    grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: CALLBACK, code_verifier: p.verifier, client_id: clientId, resource: RESOURCE,
  });
  if (res.status !== 200) throw new Error(`token → ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, clientId };
}

module.exports = {
  ISSUER, RESOURCE, CALLBACK, enable, setSetting, withIssuer, pkce, register, authorize, consentId, authorizeParams, decide, token, connect,
};
