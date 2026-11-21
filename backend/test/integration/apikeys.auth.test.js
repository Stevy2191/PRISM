const request = require('supertest');
const bcrypt = require('bcryptjs');
const {
  getApp, createUserAndLogin, resetData, closeDb, ROLE, models,
} = require('./helpers');

// API keys are 32 random bytes, so they are checked by a SHA-256 lookup, not
// bcrypt: bcrypt guards guessable passwords and cost ~0.37 s of the event
// loop per request, which stalled every other user while a script ran.
// Keys made before that keep working and move to the fast hash the first
// time they are used.

const API = '/api/v1';
const app = () => getApp();
const asKey = (key) => request(app()).get(`${API}/auth/me`).set('X-API-Key', key);

let alice;
beforeEach(async () => {
  await resetData();
  alice = await createUserAndLogin({ username: 'alice', roleName: ROLE.TECHNICIAN });
});
afterEach(() => jest.restoreAllMocks());
afterAll(closeDb);

async function newKey(agent = alice.agent, body = { name: 'Script' }) {
  const res = await agent.post(`${API}/apikeys`).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

it('a new key signs in as its owner, without bcrypt, and is stored only as a hash', async () => {
  const compare = jest.spyOn(bcrypt, 'compare');
  const { key, apiKey } = await newKey();
  expect(key).toMatch(/^prism_[0-9a-f]{64}$/);
  const res = await asKey(key);
  expect(res.status).toBe(200);
  expect(res.body.user.username).toBe('alice');
  expect(compare).not.toHaveBeenCalled();

  const row = await models.ApiKey.findByPk(apiKey.id);
  expect(row.lookupHash).toMatch(/^[0-9a-f]{64}$/);
  expect(row.lookupHash).not.toContain(key.slice(6));
  expect(row.keyHash).toBeNull();
});

it('neither hash is ever sent back', async () => {
  const created = await newKey();
  expect(created.apiKey.keyHash).toBeUndefined();
  expect(created.apiKey.lookupHash).toBeUndefined();
  const { apiKeys } = (await alice.agent.get(`${API}/apikeys`)).body;
  expect(apiKeys).toHaveLength(1);
  expect(apiKeys[0].keyHash).toBeUndefined();
  expect(apiKeys[0].lookupHash).toBeUndefined();
});

it('a wrong key is refused, even one that shares the stored prefix', async () => {
  const { key } = await newKey();
  expect((await asKey('prism_nope')).status).toBe(401);
  expect((await asKey('')).status).toBe(401);
  const samePrefix = `${key.slice(0, 14)}${'0'.repeat(key.length - 14)}`;
  expect(samePrefix).not.toBe(key);
  const res = await asKey(samePrefix);
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('INVALID_API_KEY');
});

it('expired and revoked keys, and keys of a deactivated user, are refused', async () => {
  const expired = await newKey(alice.agent, { name: 'Old', expiresAt: '2020-01-01T00:00:00Z' });
  expect((await asKey(expired.key)).status).toBe(401);

  const revoked = await newKey();
  expect((await alice.agent.delete(`${API}/apikeys/${revoked.apiKey.id}`)).status).toBeLessThan(300);
  expect((await asKey(revoked.key)).status).toBe(401);

  const live = await newKey();
  expect((await asKey(live.key)).status).toBe(200);
  await models.User.update({ isActive: false }, { where: { id: alice.user.id } });
  expect((await asKey(live.key)).status).toBe(401);
});

it('a key made before the change still works, and moves to the fast hash on first use', async () => {
  const plaintext = `prism_${'ab12'.repeat(16)}`;
  const legacy = await models.ApiKey.create({
    name: 'Legacy', userId: alice.user.id, prefix: plaintext.slice(6, 14), keyHash: await bcrypt.hash(plaintext, 4),
  });
  expect(legacy.lookupHash).toBeFalsy();

  expect((await asKey(plaintext)).status).toBe(200);
  const upgraded = await models.ApiKey.findByPk(legacy.id);
  expect(upgraded.lookupHash).toMatch(/^[0-9a-f]{64}$/);
  expect(upgraded.keyHash).toBeNull();

  const compare = jest.spyOn(bcrypt, 'compare');
  expect((await asKey(plaintext)).status).toBe(200);
  expect(compare).not.toHaveBeenCalled();
});

it('a wrong guess at a legacy key is still refused and upgrades nothing', async () => {
  const plaintext = `prism_${'cd34'.repeat(16)}`;
  const legacy = await models.ApiKey.create({
    name: 'Legacy', userId: alice.user.id, prefix: plaintext.slice(6, 14), keyHash: await bcrypt.hash(plaintext, 4),
  });
  const guess = `${plaintext.slice(0, 14)}${'0'.repeat(plaintext.length - 14)}`;
  expect((await asKey(guess)).status).toBe(401);
  const row = await models.ApiKey.findByPk(legacy.id);
  expect(row.lookupHash).toBeFalsy();
  expect(row.keyHash).toBeTruthy();
});

it('lastUsed is recorded, but not rewritten on every request', async () => {
  const { key, apiKey } = await newKey();
  expect((await asKey(key)).status).toBe(200);
  const first = (await models.ApiKey.findByPk(apiKey.id)).lastUsed;
  expect(first).toBeTruthy();
  expect((await asKey(key)).status).toBe(200);
  expect((await models.ApiKey.findByPk(apiKey.id)).lastUsed.getTime()).toBe(first.getTime());

  // Once it's more than a minute old, the next use updates it.
  await models.ApiKey.update({ lastUsed: new Date(Date.now() - 5 * 60_000) }, { where: { id: apiKey.id } });
  expect((await asKey(key)).status).toBe(200);
  expect(Date.now() - (await models.ApiKey.findByPk(apiKey.id)).lastUsed.getTime()).toBeLessThan(60_000);
});

it('checking a key no longer holds up other people\'s requests', async () => {
  const { key } = await newKey();
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: 8 }, () => asKey(key)));
  expect(results.every((r) => r.status === 200)).toBe(true);
  // bcrypt at cost 12 took ~0.37 s per key check, ~3 s for these eight.
  expect(Date.now() - started).toBeLessThan(1500);
});
