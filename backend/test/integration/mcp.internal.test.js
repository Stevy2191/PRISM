const request = require('supertest');
const {
  getApp, createUserAndLogin, resetData, closeDb, ROLE,
} = require('./helpers');
const { internalBaseUrl, withGrant } = require('../../src/mcp/internalApi');
const { loadMcp } = require('../../src/mcp/tools');

// MCP-O 4: /mcp's tools call PRISM's API as the connected person without
// ever forwarding their OAuth token. They go through an internal loopback
// listener with a grant that lives only for one MCP request.

const app = () => getApp();
let tech;
beforeEach(async () => {
  await resetData();
  tech = await createUserAndLogin({ username: 'tina', roleName: ROLE.TECHNICIAN });
});
afterAll(closeDb);

const me = (base, grant) => fetch(`${base}/api/v1/auth/me`, { headers: { 'X-PRISM-MCP-Grant': grant } });

it('inside a grant, the internal listener answers as that person', async () => {
  const base = await internalBaseUrl(app());
  expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  await withGrant(tech.user, async (grant) => {
    expect(grant).toMatch(/^[0-9a-f]{64}$/);
    const res = await me(base, grant);
    expect(res.status).toBe(200);
    expect((await res.json()).user.username).toBe('tina');
  });
});

it('the grant header does nothing on PRISM\'s public side, even while live', async () => {
  await withGrant(tech.user, async (grant) => {
    const res = await request(app()).get('/api/v1/auth/me').set('X-PRISM-MCP-Grant', grant);
    expect(res.status).toBe(401);
  });
});

it('a grant ends with its request, and an unknown grant is refused', async () => {
  const base = await internalBaseUrl(app());
  let kept;
  await withGrant(tech.user, async (grant) => { kept = grant; });
  expect((await me(base, kept)).status).toBe(401);
  expect((await me(base, 'f'.repeat(64))).status).toBe(401);
  await expect(withGrant(tech.user, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
});

it('the internal listener is one listener, reused', async () => {
  expect(await internalBaseUrl(app())).toBe(await internalBaseUrl(app()));
});

it('loads the shared MCP server and tools from mcp/', async () => {
  const mcp = await loadMcp();
  expect(typeof mcp.createMcpServer).toBe('function');
  expect(typeof mcp.PrismClient).toBe('function');
  expect(typeof mcp.StreamableHTTPServerTransport).toBe('function');
});
