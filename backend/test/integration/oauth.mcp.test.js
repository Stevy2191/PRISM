const request = require('supertest');
const {
  getApp, createUserAndLogin, resetData, closeDb, models, ROLE,
} = require('./helpers');
const {
  makeAdmin, makeContact, makeCompany, makeTicket, setCompanyAccess,
} = require('./fixtures');
const {
  ISSUER, enable, setSetting, withIssuer, connect,
} = require('./oauthHelpers');

// MCP-O 5: /mcp answers Claude with an OAuth access token, acting as the
// person who connected, and that token opens nothing else.

const app = () => getApp();
withIssuer();
let tech;
beforeEach(async () => {
  await resetData();
  await enable();
  tech = await createUserAndLogin({ username: 'tina', roleName: ROLE.TECHNICIAN });
});
afterAll(closeDb);

const CHALLENGE = `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="prism"`;
let rpcId = 0;
function rpc(token, method, params = {}) {
  rpcId += 1;
  const req = request(app()).post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({ jsonrpc: '2.0', id: rpcId, method, params });
}
const init = (token) => rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-test', version: '1' } });
const call = async (token, name, args = {}) => {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  return res.body.result;
};
const toolNames = async (token) => (await rpc(token, 'tools/list')).body.result.tools.map((t) => t.name);

describe('without a good token', () => {
  it('no token → 401 pointing Claude at the sign-in metadata', async () => {
    const res = await init(null);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
  });

  it('a bad or expired token → 401 invalid_token', async () => {
    for (const token of ['prism_oat_nope', `prism_oat_${'a'.repeat(64)}`]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await init(token);
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe(`${CHALLENGE}, error="invalid_token"`);
    }
    const t = await connect(tech.agent);
    await models.OAuthConnection.update({ accessExpiresAt: new Date(Date.now() - 1000) }, { where: {} });
    expect((await init(t.access_token)).status).toBe(401);
  });

  it('only POST is served', async () => {
    const t = await connect(tech.agent);
    expect((await request(app()).get('/mcp').set('Authorization', `Bearer ${t.access_token}`)).status).toBe(405);
    expect((await request(app()).delete('/mcp').set('Authorization', `Bearer ${t.access_token}`)).status).toBe(405);
  });
});

describe('with the token Claude got by signing in', () => {
  it('initializes, and read-only (the default) offers only the tools that look', async () => {
    const t = await connect(tech.agent);
    const res = await init(t.access_token);
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('prism');
    const names = await toolNames(t.access_token);
    expect(names).toContain('prism_list_tickets');
    expect(names).not.toContain('prism_update_ticket');
    expect(names).not.toContain('prism_create_ticket');
    expect(names).toHaveLength(19);
  });

  it('acts as the person who connected', async () => {
    const t = await connect(tech.agent);
    const result = await call(t.access_token, 'prism_whoami');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text).user.username).toBe('tina');
    const conn = await models.OAuthConnection.findOne();
    expect(conn.lastUsedAt).not.toBeNull();
  });

  it('when an Owner allows changes, Claude can change things, as that person', async () => {
    await setSetting('mcp.allowWrites', 'true');
    const admin = await makeAdmin();
    const contact = await makeContact(admin, { firstName: 'Dana' });
    const t = await connect(admin.agent);
    expect(await toolNames(t.access_token)).toHaveLength(23);
    const result = await call(t.access_token, 'prism_create_ticket', { contactId: contact.id, title: 'Printer offline' });
    expect(result.isError).toBeFalsy();
    const ticket = await models.Ticket.findOne({ where: { title: 'Printer offline' } });
    expect(ticket.createdBy).toBe(admin.user.id);
  });

  it('the person\'s own permissions still apply: no other company\'s tickets', async () => {
    const admin = await makeAdmin();
    const mine = await makeCompany(admin, { name: 'Washington County' });
    const theirs = await makeCompany(admin, { name: 'Acme', code: 'ACME' });
    await setCompanyAccess(admin, tech.user.id, { allCompanies: false, companyIds: [mine.id] });
    const hidden = await makeTicket(admin.agent, { title: 'Acme payroll', contactId: (await makeContact(admin, { companyId: theirs.id })).id });
    const seen = await makeTicket(admin.agent, { title: 'WC printer', contactId: (await makeContact(admin, { companyId: mine.id })).id });
    const t = await connect(tech.agent);
    expect((await call(t.access_token, 'prism_get_ticket', { ticket: seen.id })).isError).toBeFalsy();
    const denied = await call(t.access_token, 'prism_get_ticket', { ticket: hidden.ticketNumber });
    expect(denied.isError).toBe(true);
    const listed = JSON.parse((await call(t.access_token, 'prism_list_tickets', {})).content[0].text);
    expect(listed.tickets.map((x) => x.id)).toEqual([seen.id]);
  });
});

describe('the token never opens anything else', () => {
  it('token never opens the API: not as a bearer token, not as an API key', async () => {
    const t = await connect(tech.agent);
    expect((await request(app()).get('/api/v1/auth/me').set('Authorization', `Bearer ${t.access_token}`)).status).toBe(401);
    expect((await request(app()).get('/api/v1/auth/me').set('X-API-Key', t.access_token)).status).toBe(401);
  });
});

describe('connections end', () => {
  it('when the person is deactivated', async () => {
    const t = await connect(tech.agent);
    await models.User.update({ isActive: false }, { where: { id: tech.user.id } });
    expect((await init(t.access_token)).status).toBe(401);
  });

  it('when an Owner turns connections off (404, as if /mcp did not exist)', async () => {
    const t = await connect(tech.agent);
    await setSetting('mcp.enabled', 'false');
    expect((await init(t.access_token)).status).toBe(404);
  });

  it('when the connection is revoked', async () => {
    const t = await connect(tech.agent);
    await models.OAuthConnection.update({ revokedAt: new Date(), revokedReason: 'admin' }, { where: {} });
    expect((await init(t.access_token)).status).toBe(401);
  });

  it('when PUBLIC_APP_URL changes, old tokens are for another address', async () => {
    const t = await connect(tech.agent);
    process.env.PUBLIC_APP_URL = 'https://new.example.test';
    try {
      expect((await init(t.access_token)).status).toBe(401);
    } finally {
      process.env.PUBLIC_APP_URL = ISSUER;
    }
  });
});
