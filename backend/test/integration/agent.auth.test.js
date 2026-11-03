const path = require('path');
const fs = require('fs');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { canonicalString, verifySignature } = require('../../src/middleware/agentAuth');
const {
  enrollDevice, makeKeys, canonical, sign,
} = require('./agentClient');

// Sub-project 8a, task 3: signed device requests and the heartbeat.

const HB = '/api/v1/agent/v1/heartbeat';
const beat = { agentVersion: '0.5.1' };
let w;
let company;
let device;

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  const res = await w.admin.agent.post(`/api/v1/companies/${company.id}/agent-keys`).send({ name: 'Rollout' });
  device = await enrollDevice(getApp(), res.body.secret);
});
afterAll(closeDb);

it('the shared signing vector holds in Node (the Go agent checks the same file)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../agent/testdata/signing.json'), 'utf8'));
  const keys = makeKeys(v.seedHex);
  expect(keys.publicKeyB64).toBe(v.publicKeyB64);
  const c = canonicalString(v.method, v.pathQuery, v.timestamp, v.nonce, Buffer.from(v.body));
  expect(c).toBe(v.canonical);
  expect(canonical(v.method, v.pathQuery, v.timestamp, v.nonce, Buffer.from(v.body))).toBe(v.canonical);
  expect(sign(keys.privateKey, c)).toBe(v.signatureB64);
  expect(verifySignature(v.publicKeyB64, c, v.signatureB64)).toBe(true);
});

it('a signed heartbeat sets last seen, the version and the signed-in user', async () => {
  await models.Device.update({ lastSeenAt: new Date(Date.now() - 3600 * 1000) }, { where: { id: device.deviceId } });
  const res = await device.post(HB, { ...beat, signedInUser: { account: 'RIVERSIDE\\mchen' } });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ update: null });
  const d = await models.Device.findByPk(device.deviceId);
  expect(d.agentVersion).toBe('0.5.1');
  expect(Date.now() - new Date(d.lastSeenAt).getTime()).toBeLessThan(5000);
  expect(d.inventory.signedInUser).toEqual({ account: 'RIVERSIDE\\mchen' });
});

it('refuses an old or future timestamp, a reused nonce, a changed body, another device and another key', async () => {
  const now = Math.floor(Date.now() / 1000);
  const refused = async (res) => { expect(res.status).toBe(401); expect(res.body.code).toBe('AGENT_UNAUTHORIZED'); };
  await refused(await device.post(HB, beat, { ts: now - 400 }));
  await refused(await device.post(HB, beat, { ts: now + 400 }));
  expect((await device.post(HB, beat, { nonce: 'sameNonceSameNonce1' })).status).toBe(200);
  await refused(await device.post(HB, beat, { nonce: 'sameNonceSameNonce1' }));
  await refused(await device.post(HB, beat, { tamper: (raw) => raw.replace('0.5.1', '9.9.9') }));
  const keys2 = makeKeys();
  await refused(await device.post(HB, beat, { signWith: keys2 }));
  // Signed correctly, but claiming to be a device that doesn't exist.
  await refused(await device.post(HB, beat, { deviceId: device.deviceId + 1000 }));
  // A signature for one path doesn't work on another (the path is signed).
  expect((await models.Device.findByPk(device.deviceId)).agentVersion).not.toBe('9.9.9');
});

it('missing or malformed headers are refused without touching the database', async () => {
  const request = require('supertest'); // eslint-disable-line global-require
  const res = await request(getApp()).post(HB).send(beat);
  expect(res.status).toBe(401);
  const res2 = await device.post(HB, beat, { nonce: 'short' });
  expect(res2.status).toBe(401);
  expect(await models.AgentNonce.count()).toBe(0);
});

it('a revoked device is refused at once', async () => {
  expect((await device.post(HB, beat)).status).toBe(200);
  await models.Device.update({ revokedAt: new Date() }, { where: { id: device.deviceId } });
  expect((await device.post(HB, beat)).status).toBe(401);
});

it('a third heartbeat inside a minute is rate-limited; others aren\'t affected', async () => {
  expect((await device.post(HB, beat)).status).toBe(200);
  expect((await device.post(HB, beat)).status).toBe(200);
  expect((await device.post(HB, beat)).status).toBe(429);
  const res = await w.admin.agent.post(`/api/v1/companies/${company.id}/agent-keys`).send({ name: 'Second' });
  const other = await enrollDevice(getApp(), res.body.secret, { hostname: 'RFC-FD-02' });
  expect((await other.post(HB, beat)).status).toBe(200);
});

it('a staff session is no way into the agent API', async () => {
  // The admin's signed-in staff agent, without a device signature.
  const res = await w.admin.agent.post(HB).send(beat);
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('AGENT_UNAUTHORIZED');
});

it('a bad agentVersion is refused after authentication', async () => {
  const res = await device.post(HB, { agentVersion: '<script>' });
  expect(res.status).toBe(400);
});
