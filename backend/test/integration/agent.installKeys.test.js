const crypto = require('crypto');
const request = require('supertest');
const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, getApp, sequelize,
} = require('./helpers');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { makeWorld, makeCompany, makeTech } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const migration = require('../../migrations/20260101000083-enrollment-key-copy');

// Sub-project 8d, task 1: install keys you can copy again, rotate and limit.

const API = '/api/v1';
let w;
let company;

const publicKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
const payload = (secret, extra = {}) => ({
  enrollKey: secret, publicKey: publicKey(), platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'RFC-FD-01', ...extra,
});
const enrollAs = (body) => request(getApp()).post(`${API}/agent/v1/enroll`).send(body);
const keysUrl = () => `${API}/companies/${company.id}/agent-keys`;
async function newKey(body = { name: 'Rollout' }) {
  const res = await w.admin.agent.post(keysUrl()).send(body);
  if (res.status !== 201) throw new Error(`key: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
});
afterAll(closeDb);

it('a key can be copied again by Manage devices staff, each time audited, never in a list', async () => {
  const { key, secret } = await newKey();
  expect(key).toMatchObject({ copyable: true, maxUses: null, usedUp: false });
  const stored = await models.AgentEnrollmentKey.scope('withHash').findByPk(key.id);
  expect(stored.secretEnc).toBeTruthy();
  expect(stored.secretEnc).not.toContain(secret);

  const shown = await w.admin.agent.post(`${keysUrl()}/${key.id}/reveal`);
  expect(shown.status).toBe(200);
  expect(shown.body.secret).toBe(secret);
  await w.admin.agent.post(`${keysUrl()}/${key.id}/reveal`);
  expect(await models.AuditLog.count({ where: { action: 'agent.key_revealed' } })).toBe(2);

  const list = await w.admin.agent.get(keysUrl());
  expect(list.body.keys[0]).toMatchObject({ copyable: true });
  expect(JSON.stringify(list.body)).not.toContain(secret);
  expect(JSON.stringify(list.body)).not.toContain(stored.secretEnc);
  // The model's default scope never carries the copy either.
  expect((await models.AgentEnrollmentKey.findByPk(key.id)).secretEnc).toBeUndefined();

  // Without Manage devices: refused.
  const tech = await makeTech('tech-keys', w.deptA.id);
  expect((await tech.agent.post(`${keysUrl()}/${key.id}/reveal`)).status).toBe(403);
  expect((await tech.agent.post(`${keysUrl()}/${key.id}/rotate`)).status).toBe(403);
});

it('another company\'s key is not found through this company', async () => {
  const other = await makeCompany(w.admin, { name: 'Lakeside' });
  const { key } = await newKey();
  expect((await w.admin.agent.post(`${API}/companies/${other.id}/agent-keys/${key.id}/reveal`)).status).toBe(404);
  expect((await w.admin.agent.post(`${API}/companies/${other.id}/agent-keys/${key.id}/rotate`)).status).toBe(404);
});

it('rotating gives a new secret; the old one stops enrolling; history and enrolled computers stay', async () => {
  const { key, secret } = await newKey();
  const first = await enrollAs(payload(secret, { serialNumber: 'SER-1' }));
  expect(first.status).toBe(201);
  const rotated = await w.admin.agent.post(`${keysUrl()}/${key.id}/rotate`);
  expect(rotated.status).toBe(200);
  expect(rotated.body.secret).toMatch(/^pk_enr_[A-Za-z0-9_-]{43}$/);
  expect(rotated.body.secret).not.toBe(secret);
  expect(rotated.body.key).toMatchObject({ id: key.id, name: 'Rollout', enrolledCount: 1, copyable: true });
  expect((await enrollAs(payload(secret, { hostname: 'B', serialNumber: 'SER-2' }))).status).toBe(401);
  expect((await enrollAs(payload(rotated.body.secret, { hostname: 'C', serialNumber: 'SER-3' }))).status).toBe(201);
  expect((await w.admin.agent.post(`${keysUrl()}/${key.id}/reveal`)).body.secret).toBe(rotated.body.secret);
  expect((await models.Device.findByPk(first.body.deviceId)).revokedAt).toBeNull();
  expect(await models.AuditLog.count({ where: { action: 'agent.key_rotated' } })).toBe(1);
  // A revoked key can't be rotated or revealed.
  await w.admin.agent.post(`${keysUrl()}/${key.id}/revoke`);
  expect((await w.admin.agent.post(`${keysUrl()}/${key.id}/rotate`)).status).toBe(400);
  expect((await w.admin.agent.post(`${keysUrl()}/${key.id}/reveal`)).status).toBe(400);
});

it('a limit refuses the next computer, not a retry of one it already enrolled', async () => {
  expect((await w.admin.agent.post(keysUrl()).send({ name: 'X', maxUses: 0 })).status).toBe(400);
  expect((await w.admin.agent.post(keysUrl()).send({ name: 'X', maxUses: 'lots' })).status).toBe(400);
  const { key, secret } = await newKey({ name: 'Two only', maxUses: 2 });
  expect(key.maxUses).toBe(2);
  const a = await enrollAs(payload(secret, { hostname: 'A', serialNumber: 'SER-A' }));
  const b = await enrollAs(payload(secret, { hostname: 'B', serialNumber: 'SER-B' }));
  expect([a.status, b.status]).toEqual([201, 201]);
  const third = await enrollAs(payload(secret, { hostname: 'C', serialNumber: 'SER-C' }));
  expect(third.status).toBe(403);
  expect(third.body.code).toBe('ENROLL_KEY_USED_UP');
  expect(await models.Asset.count({ where: { name: 'C' } })).toBe(0);
  // B failed on the computer (never reported) and tries again: allowed, not counted.
  const again = await enrollAs(payload(secret, { hostname: 'B', serialNumber: 'SER-B' }));
  expect(again.status).toBe(201);
  expect(again.body.deviceId).toBe(b.body.deviceId);
  const listed = (await w.admin.agent.get(keysUrl())).body.keys[0];
  expect(listed).toMatchObject({ enrolledCount: 2, maxUses: 2, usedUp: true, usable: false });
  expect(listed.lastUsedAt).toBeTruthy();
});

it('computers enrolling at once never go past the limit', async () => {
  const { secret } = await newKey({ name: 'Three', maxUses: 3 });
  const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => enrollAs(payload(secret, { hostname: `PC-${n}`, serialNumber: `SER-${n}` }))));
  // Database lock conflicts between them are retried, never a 500.
  expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 403, 403, 403, 403, 403, 403, 403]);
  expect(await models.Device.count({ where: { companyId: company.id } })).toBe(3);
});

it('a key made before 8d keeps enrolling, can\'t be revealed, and can be after rotating', async () => {
  const { key, secret } = await newKey({ name: 'Old' });
  await sequelize.query('UPDATE AgentEnrollmentKeys SET secretEnc = NULL WHERE id = ?', { replacements: [key.id] });
  expect((await w.admin.agent.get(keysUrl())).body.keys[0].copyable).toBe(false);
  const res = await w.admin.agent.post(`${keysUrl()}/${key.id}/reveal`);
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('KEY_NOT_COPYABLE');
  expect((await enrollAs(payload(secret))).status).toBe(201);
  const rotated = await w.admin.agent.post(`${keysUrl()}/${key.id}/rotate`);
  expect((await w.admin.agent.post(`${keysUrl()}/${key.id}/reveal`)).body.secret).toBe(rotated.body.secret);
});

it('many computers enrolling at once with an unlimited key all get in', async () => {
  const { secret, key } = await newKey({ name: 'Rollout' });
  const results = await Promise.all(Array.from({ length: 12 }, (_, n) => enrollAs(payload(secret, { hostname: `PC-${n}`, serialNumber: `SER-${n}` }))));
  expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
  expect((await models.AgentEnrollmentKey.findByPk(key.id)).enrolledCount).toBe(12);
});

it('migration 083 round trip', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  try {
    const cols = await qi.describeTable('AgentEnrollmentKeys');
    expect(cols.secretEnc).toBeUndefined();
    expect(cols.maxUses).toBeUndefined();
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize); // idempotent
  expect(Object.keys(await qi.describeTable('AgentEnrollmentKeys'))).toEqual(expect.arrayContaining(['secretEnc', 'maxUses', 'lastUsedAt']));
  invalidateAllPermissions();
});
