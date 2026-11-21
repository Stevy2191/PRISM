const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeTech,
} = require('./fixtures');
const {
  ISSUER, withIssuer, connect, token,
} = require('./oauthHelpers');

// MCP-O 6: an Owner turns Claude connections on, decides whether Claude may
// change things, and sees and revokes every connection.

withIssuer();
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

const owner = () => w.admin.agent;

it('is off until an Owner turns it on, and reports the connector address', async () => {
  const before = expectOk(await owner().get(`${API}/oauth/settings`));
  expect(before).toEqual({
    enabled: false,
    allowWrites: false,
    allowedDomains: ['claude.ai', 'claude.com', 'localhost', '127.0.0.1'],
    connectorUrl: `${ISSUER}/mcp`,
    httpsReady: true,
  });
  const after = expectOk(await owner().put(`${API}/oauth/settings`).send({ enabled: true, allowWrites: true, allowedDomains: ['claude.ai', ' Claude.com '] }));
  expect(after).toMatchObject({ enabled: true, allowWrites: true, allowedDomains: ['claude.ai', 'claude.com'] });
  expect(await models.AuditLog.count({ where: { action: 'oauth.settings' } })).toBe(1);
});

it('only an Owner sees or changes it; a System Administrator does not', async () => {
  for (const [verb, path] of [['get', '/oauth/settings'], ['put', '/oauth/settings'], ['get', '/oauth/connections'], ['delete', '/oauth/connections/1']]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await sysadmin.agent[verb](`${API}${path}`).send({ enabled: true });
    expect([path, res.status, res.body.code]).toEqual([path, 403, 'OWNER_ONLY']);
  }
  const res = await sysadmin.agent.patch(`${API}/settings`).send({ 'mcp.enabled': 'true' });
  expect(res.status).toBeLessThan(500);
  expect(expectOk(await owner().get(`${API}/oauth/settings`)).enabled).toBe(false);
});

it('cannot be turned on without an https PUBLIC_APP_URL', async () => {
  process.env.PUBLIC_APP_URL = 'http://help.example.test';
  try {
    const settings = expectOk(await owner().get(`${API}/oauth/settings`));
    expect(settings.httpsReady).toBe(false);
    const res = await owner().put(`${API}/oauth/settings`).send({ enabled: true });
    expect([res.status, res.body.code]).toEqual([400, 'HTTPS_REQUIRED']);
  } finally {
    process.env.PUBLIC_APP_URL = ISSUER;
  }
});

it('refuses an empty or nonsensical domain list', async () => {
  for (const allowedDomains of [[], ['not a domain'], ['https://claude.ai'], 'claude.ai']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await owner().put(`${API}/oauth/settings`).send({ allowedDomains });
    expect([allowedDomains, res.status]).toEqual([allowedDomains, 400]);
  }
});

it('lists every connection and an Owner revokes one', async () => {
  expectOk(await owner().put(`${API}/oauth/settings`).send({ enabled: true }));
  const tina = await makeTech('tina', w.deptA.id);
  const t = await connect(tina.agent);
  const { connections } = expectOk(await owner().get(`${API}/oauth/connections`));
  expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({ user: { username: 'tina' }, client: { name: 'Claude' }, revokedAt: null });
  expect(connections[0].accessHash).toBeUndefined();

  expectOk(await owner().delete(`${API}/oauth/connections/${connections[0].id}`));
  const conn = await models.OAuthConnection.findByPk(connections[0].id);
  expect([conn.revokedReason, !!conn.revokedAt]).toEqual(['admin', true]);
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId });
  expect(refreshed.body.error).toBe('invalid_grant');
  expect(await models.AuditLog.count({ where: { action: 'oauth.revoke', userId: w.admin.user.id } })).toBe(1);
  // Revoked connections drop off the list.
  expect(expectOk(await owner().get(`${API}/oauth/connections`)).connections).toHaveLength(0);
  expect((await owner().delete(`${API}/oauth/connections/999999`)).status).toBe(404);
});
