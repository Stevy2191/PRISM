const {
  createUserAndLogin, resetData, closeDb, models, ROLE,
} = require('./helpers');
const { pruneOAuth } = require('../../src/services/oauth/cleanup');

// MCP-O: expired consents and codes, long-dead connections, and apps that
// registered but never connected are cleared daily, so open registration
// can't grow the tables forever. Live connections and their apps stay.

const DAY = 24 * 60 * 60 * 1000;
let tina;
beforeEach(async () => {
  await resetData();
  tina = await createUserAndLogin({ username: 'tina', roleName: ROLE.TECHNICIAN });
});
afterAll(closeDb);

const ago = (days) => new Date(Date.now() - days * DAY);
const client = (clientId, createdAt = ago(10)) => models.OAuthClient.create({
  clientId, kind: 'dcr', name: clientId, redirectUris: ['https://claude.ai/cb'], createdAt,
}, { silent: true });
const request = (c, id, expiresAt) => models.OAuthRequest.create({
  id, clientId: c.id, redirectUri: 'https://claude.ai/cb', codeChallenge: 'x'.repeat(43), scope: 'prism', resource: 'https://h/mcp', expiresAt,
});
let seq = 0;
const connection = (c, fields = {}) => {
  seq += 1;
  return models.OAuthConnection.create({
    clientId: c.id, userId: tina.user.id, scope: 'prism', resource: 'https://h/mcp',
    accessHash: `a${seq}`.padEnd(64, '0'), accessExpiresAt: ago(0), refreshHash: `r${seq}`.padEnd(64, '0'), refreshExpiresAt: new Date(Date.now() + DAY), ...fields,
  });
};

it('clears what is dead and keeps what is live', async () => {
  const live = await client('live');
  const unused = await client('never-connected');
  const fresh = await client('just-registered', new Date());
  const revokedOnly = await client('revoked-long-ago');

  await request(live, 'pending-now', new Date(Date.now() + 60_000));
  await request(live, 'expired-days-ago', ago(2));
  const keep = await connection(live);
  await connection(live, { refreshExpiresAt: ago(40) });
  await connection(revokedOnly, { revokedAt: ago(40), revokedReason: 'admin' });
  const recentlyRevoked = await connection(live, { revokedAt: ago(1), revokedReason: 'admin' });

  const result = await pruneOAuth();

  expect((await models.OAuthRequest.findAll()).map((r) => r.id)).toEqual(['pending-now']);
  expect((await models.OAuthConnection.findAll()).map((c) => c.id).sort()).toEqual([keep.id, recentlyRevoked.id].sort());
  const clients = (await models.OAuthClient.findAll()).map((c) => c.clientId).sort();
  expect(clients).toEqual(['just-registered', 'live']);
  expect(unused.id).toBeTruthy();
  expect(fresh.id).toBeTruthy();
  expect(result).toEqual({ requests: 1, connections: 2, clients: 2 });
});
