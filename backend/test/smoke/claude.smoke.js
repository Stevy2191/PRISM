const request = require('supertest');
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeTech } = require('../integration/fixtures');
const {
  ISSUER, CALLBACK, pkce, register, authorize, consentId, authorizeParams,
} = require('../integration/oauthHelpers');
const { startSmoke } = require('./harness');

// MCP-O in a browser: an Owner turns Claude connections on in Settings ›
// Claude; a technician coming from Claude signs in, sees the consent page,
// allows, and is sent back to Claude with a code; the Owner sees the
// connection and revokes it.

let smoke;
let saved;
beforeAll(async () => {
  saved = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = ISSUER;
  smoke = await startSmoke();
});
afterAll(async () => {
  if (saved === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = saved;
  await smoke.stop();
  await closeDb();
});
beforeEach(resetData);

it('turn on, connect from Claude, see it, revoke it', async () => {
  const admin = await makeAdmin();
  const owner = await smoke.pageAs('admin');
  await owner.goto('/settings/claude');
  await owner.getByText('Let people connect Claude').waitFor();
  expect(await owner.getByLabel('Connector URL').textContent()).toBe(`${ISSUER}/mcp`);
  await owner.getByRole('checkbox', { name: /Let people connect Claude/ }).check();
  await owner.getByText('Saved').waitFor();
  expect((await models.SystemSettings.findByPk('mcp.enabled')).value).toBe('true');
  await owner.getByText('No one has connected yet.').waitFor();

  // Claude starts the sign-in (server to server), then sends the browser to
  // PRISM's consent page.
  const clientId = await register();
  const id = consentId(await authorize(authorizeParams(clientId, pkce())));
  await makeTech('tina');
  const browser = await smoke.browser.newContext({ baseURL: smoke.base });
  const page = await browser.newPage();
  let landed = null;
  await page.route('https://claude.ai/**', (route) => {
    landed = new URL(route.request().url());
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Back in Claude</p>' });
  });
  await page.goto(`/oauth/consent/${id}`);
  // Not signed in yet: sign in, and come back to the same consent.
  await page.getByLabel(/Username/i).fill('tina');
  await page.getByLabel(/^Password/i).fill('IntegrationPass!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect Claude to PRISM?' }).waitFor();
  await page.getByText('claude.ai', { exact: true }).waitFor();
  await page.getByText(/only look/).waitFor();
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.getByText('Back in Claude').waitFor();
  expect(`${landed.origin}${landed.pathname}`).toBe(CALLBACK);
  expect(landed.searchParams.get('code')).toMatch(/^prism_oac_/);
  expect(landed.searchParams.get('state')).toBe('xyz-state');
  await browser.close();

  // Claude exchanges the code; the Owner sees the connection and revokes it.
  const req = await models.OAuthRequest.findByPk(id);
  expect(req.userId).toBeTruthy();
  await models.OAuthConnection.create({
    clientId: req.clientId, userId: req.userId, scope: 'prism', resource: `${ISSUER}/mcp`,
    accessHash: 'a'.repeat(64), accessExpiresAt: new Date(Date.now() + 3600e3), refreshHash: 'b'.repeat(64), refreshExpiresAt: new Date(Date.now() + 86400e3),
  });
  await owner.reload();
  const row = owner.getByRole('row', { name: /Claude/ });
  await row.getByText(/Tina|tina/).waitFor();
  owner.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Revoke' }).click();
  await owner.getByText('No one has connected yet.').waitFor();
  expect((await models.OAuthConnection.findOne()).revokedReason).toBe('admin');
  expect(admin.user.id).toBeTruthy();
});

it('a request PRISM can\'t trust shows an explanation, not a redirect', async () => {
  await makeAdmin();
  await models.SystemSettings.upsert({ key: 'mcp.enabled', value: 'true' });
  const res = await request(smoke.base).get('/api/v1/oauth/authorize').query({
    response_type: 'code', client_id: 'nobody', redirect_uri: 'https://evil.test/cb', code_challenge: pkce().challenge, code_challenge_method: 'S256',
  });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.location);
  const page = await smoke.pageAs('admin');
  await page.goto(`${loc.pathname}${loc.search}`);
  await page.getByText('Can\'t connect that app').waitFor();
  await page.getByText(/doesn't recognise the app/).waitFor();
});
