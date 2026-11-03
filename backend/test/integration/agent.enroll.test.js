const crypto = require('crypto');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp, sequelize,
} = require('./helpers');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const {
  makeWorld, makeCompany, makeTech, setCompanyAccess,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 8a, task 2: enrolment keys and device enrolment.

const API = '/api/v1';
let w;
let company;
let other;

const publicKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
const payload = (secret, extra = {}) => ({
  enrollKey: secret, publicKey: publicKey(), platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'RFC-FD-01',
  serialNumber: '7XK4Q93', make: 'Dell Inc.', model: 'OptiPlex 7010', ...extra,
});
const enrollAs = (body) => request(getApp()).post(`${API}/agent/v1/enroll`).send(body);
async function newKey(target = company, body = { name: 'Rollout' }, by = w.admin) {
  const res = await by.agent.post(`${API}/companies/${target.id}/agent-keys`).send(body);
  if (res.status !== 201) throw new Error(`key: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const computers = () => models.AssetCategory.findOne({ where: { name: 'Computers' } });

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  other = await makeCompany(w.admin, { name: 'Lakeside' });
});
afterAll(closeDb);

it('a key is shown once, stored hashed, and listed without its secret', async () => {
  const { key, secret } = await newKey();
  expect(secret).toMatch(/^pk_enr_[A-Za-z0-9_-]{43}$/);
  const stored = await models.AgentEnrollmentKey.scope('withHash').findByPk(key.id);
  expect(stored.keyHash).toBe(crypto.createHash('sha256').update(secret).digest('hex'));
  const list = await w.admin.agent.get(`${API}/companies/${company.id}/agent-keys`);
  expect(list.status).toBe(200);
  expect(list.body.keys).toHaveLength(1);
  expect(JSON.stringify(list.body)).not.toContain(secret);
  expect(JSON.stringify(list.body)).not.toContain(stored.keyHash);
  expect(list.body.keys[0]).toMatchObject({ name: 'Rollout', enrolledCount: 0, usable: true });
});

it('a new serial number becomes a Computers Asset of the key\'s company', async () => {
  const { secret, key } = await newKey();
  const res = await enrollAs(payload(secret));
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ deviceId: expect.any(Number), intervals: { heartbeatSec: 300, inventorySec: 21600 } });
  const device = await models.Device.findByPk(res.body.deviceId, { include: ['asset'] });
  expect(device).toMatchObject({ companyId: company.id, platform: 'windows', hostname: 'RFC-FD-01', enrollmentKeyId: key.id });
  expect(device.asset).toMatchObject({
    companyId: company.id, name: 'RFC-FD-01', serialNumber: '7XK4Q93', make: 'Dell Inc.', categoryId: (await computers()).id,
  });
  expect(device.asset.assetTag).toMatch(/^PC-/);
  expect((await models.AgentEnrollmentKey.findByPk(key.id)).enrolledCount).toBe(1);
  expect(await models.AuditLog.count({ where: { action: 'agent.enrolled', entityId: device.id } })).toBe(1);
});

it('an existing Asset with the same serial in that company is claimed, not duplicated', async () => {
  const existing = await models.Asset.create({
    assetTag: 'RFC-0117', name: 'Front desk PC', categoryId: (await computers()).id, companyId: company.id, serialNumber: '7xk4 q93', locationRoom: 'Reception',
  });
  const { secret } = await newKey();
  const res = await enrollAs(payload(secret));
  expect(res.status).toBe(201);
  const device = await models.Device.findByPk(res.body.deviceId);
  expect(device.assetId).toBe(existing.id);
  expect(await models.Asset.count({ where: { companyId: company.id } })).toBe(1);
  // Staff-owned fields are left alone.
  expect((await models.Asset.findByPk(existing.id)).locationRoom).toBe('Reception');
});

it('a matching serial in another company is never claimed', async () => {
  const theirs = await models.Asset.create({
    assetTag: 'LLG-0031', name: 'Lakeside PC', categoryId: (await computers()).id, companyId: other.id, serialNumber: '7XK4Q93',
  });
  const { secret } = await newKey(company);
  const res = await enrollAs(payload(secret));
  const device = await models.Device.findByPk(res.body.deviceId);
  expect(device.assetId).not.toBe(theirs.id);
  expect(device.companyId).toBe(company.id);
  expect(await models.Device.count({ where: { assetId: theirs.id } })).toBe(0);
});

it('a second computer with the same serial gets its own Asset; a revoked device\'s Asset is re-used', async () => {
  const { secret } = await newKey();
  const first = await enrollAs(payload(secret));
  const second = await enrollAs(payload(secret));
  const [d1, d2] = await Promise.all([models.Device.findByPk(first.body.deviceId), models.Device.findByPk(second.body.deviceId)]);
  expect(d1.assetId).not.toBe(d2.assetId);
  await d1.update({ revokedAt: new Date() });
  const again = await enrollAs(payload(secret));
  const d3 = await models.Device.findByPk(again.body.deviceId);
  expect(d3.assetId).toBe(d1.assetId);
  expect(d3.id).toBe(d1.id);
  expect(d3.revokedAt).toBeNull();
});

it('placeholder serials ("To be filled by O.E.M.") never claim an Asset', async () => {
  await models.Asset.create({
    assetTag: 'RFC-0200', name: 'Some PC', categoryId: (await computers()).id, companyId: company.id, serialNumber: 'To be filled by O.E.M.',
  });
  const { secret } = await newKey();
  await enrollAs(payload(secret, { serialNumber: 'To be filled by O.E.M.' }));
  expect(await models.Asset.count({ where: { companyId: company.id } })).toBe(2);
});

it('refuses unknown, revoked and expired keys, and bad payloads, creating nothing', async () => {
  const { secret, key } = await newKey();
  expect((await enrollAs(payload('pk_enr_' + 'x'.repeat(43)))).status).toBe(401);
  expect((await enrollAs(payload('not-a-key'))).status).toBe(401);
  expect((await enrollAs(payload(secret, { publicKey: 'short' }))).status).toBe(400);
  expect((await enrollAs(payload(secret, { platform: 'plan9' }))).status).toBe(400);
  expect((await enrollAs(payload(secret, { hostname: '' }))).status).toBe(400);
  await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys/${key.id}/revoke`).expect(200);
  expect((await enrollAs(payload(secret))).status).toBe(401);
  const { secret: later, key: k2 } = await newKey(company, { name: 'Short', expiresAt: new Date(Date.now() + 60000).toISOString() });
  await models.AgentEnrollmentKey.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: k2.id } });
  expect((await enrollAs(payload(later))).status).toBe(401);
  expect(await models.Device.count()).toBe(0);
  expect(await models.Asset.count({ where: { companyId: company.id } })).toBe(0);
});

it('keys need devices.manage and the company in reach', async () => {
  const tech = await makeTech('tech-agent', w.deptA.id);
  expect((await tech.agent.get(`${API}/companies/${company.id}/agent-keys`)).status).toBe(403);
  expect((await tech.agent.post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'X' })).status).toBe(403);
  // Given devices.manage but fenced to the other company: only that one's keys.
  await sequelize.query(
    "INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt) VALUES (:u, 'devices.manage', 1, NOW())",
    { replacements: { u: tech.user.id } }
  );
  invalidateAllPermissions();
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [other.id] });
  expect((await tech.agent.get(`${API}/companies/${other.id}/agent-keys`)).status).toBe(200);
  expect((await tech.agent.get(`${API}/companies/${company.id}/agent-keys`)).status).toBe(403);
  expect((await tech.agent.post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'X' })).status).toBe(403);
});

it('a revoked key leaves computers enrolled with it working; revoking twice is harmless', async () => {
  const { secret, key } = await newKey();
  const res = await enrollAs(payload(secret));
  await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys/${key.id}/revoke`).expect(200);
  const again = await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys/${key.id}/revoke`);
  expect(again.status).toBe(200);
  expect(again.body.key.usable).toBe(false);
  expect((await models.Device.findByPk(res.body.deviceId)).revokedAt).toBeNull();
  // Another company's key id isn't reachable through this company.
  const { key: theirs } = await newKey(other);
  expect((await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys/${theirs.id}/revoke`)).status).toBe(404);
});
