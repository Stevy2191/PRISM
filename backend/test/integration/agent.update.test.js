const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { makeKeys, agentClient } = require('./agentClient');
const { compareVersions, updateKey, signedText } = require('../../src/services/agent/updates');

// Sub-project 8a, task 6: signed agent updates served by PRISM.

const UPDATE = '/api/v1/agent/v1/update';
const DOWNLOAD = '/api/v1/agent/v1/update/download';
const HB = '/api/v1/agent/v1/heartbeat';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
let w;
let secret;
let dist;
const savedDist = process.env.AGENT_DIST_DIR;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function publish(entries) {
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(entries));
}
function pkg(version, { platform = 'windows', arch = 'amd64', bytes } = {}) {
  const file = `prism-agent-${version}-${platform}-${arch}.msi`;
  const data = bytes || Buffer.from(`MSI ${version} ${platform} ${arch}`);
  fs.writeFileSync(path.join(dist, file), data);
  return {
    platform, arch, version, file, sha256: sha(data),
  };
}
const verifies = (publicKeyB64, text, sigB64) => crypto.verify(
  null,
  Buffer.from(text),
  crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyB64, 'base64')]), format: 'der', type: 'spki' }),
  Buffer.from(sigB64, 'base64'),
);

// Enrols a device and returns its client plus the update key it was given.
async function enroll(extra = {}) {
  const keys = makeKeys();
  const res = await request(getApp()).post('/api/v1/agent/v1/enroll').send({
    enrollKey: secret, publicKey: keys.publicKeyB64, platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: `PC-${crypto.randomBytes(3).toString('hex')}`, ...extra,
  });
  expect(res.status).toBe(201);
  return { client: agentClient(getApp(), res.body.deviceId, keys), updatePublicKey: res.body.updatePublicKey };
}

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dist-'));
  process.env.AGENT_DIST_DIR = dist;
  w = await makeWorld();
  const company = await makeCompany(w.admin, { name: 'Riverside' });
  secret = (await w.admin.agent.post(`/api/v1/companies/${company.id}/agent-keys`).send({ name: 'Rollout' })).body.secret;
});
afterEach(() => fs.rmSync(dist, { recursive: true, force: true }));
afterAll(async () => {
  if (savedDist === undefined) delete process.env.AGENT_DIST_DIR; else process.env.AGENT_DIST_DIR = savedDist;
  await closeDb();
});

it('the update key is made once, stored encrypted, and its private half is never in a response', async () => {
  const a = await enroll();
  const b = await enroll();
  expect(a.updatePublicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(b.updatePublicKey).toBe(a.updatePublicKey);
  const row = await models.SystemSettings.findByPk('agent.updateKey');
  // Stored encrypted (iv:tag:ciphertext), never as the raw seed.
  expect(row.value.split(':')).toHaveLength(3);
  const settings = await w.admin.agent.get('/api/v1/settings');
  expect(JSON.stringify(settings.body)).not.toContain(row.value);
  expect(JSON.stringify(settings.body)).not.toContain('agent.updateKey');
  // Two first uses at the same time agree on one key.
  await models.SystemSettings.destroy({ where: { key: 'agent.updateKey' } });
  const [k1, k2] = await Promise.all([updateKey(), updateKey()]);
  expect(k1.publicKeyB64).toBe(k2.publicKeyB64);
});

it('a newer package is offered with a signature that verifies with the key from enrolment', async () => {
  const { client, updatePublicKey } = await enroll();
  const p = pkg('0.6.0');
  publish([pkg('0.5.0'), p, pkg('0.7.0', { arch: 'arm64' }), pkg('0.9.0', { platform: 'linux' })]);
  const res = await client.get(UPDATE);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ version: '0.6.0', sha256: p.sha256, size: Buffer.from('MSI 0.6.0 windows amd64').length });
  expect(verifies(updatePublicKey, `windows|amd64|0.6.0|${p.sha256}`, res.body.signature)).toBe(true);
  // Signed for this platform and version only.
  expect(verifies(updatePublicKey, `windows|amd64|0.7.0|${p.sha256}`, res.body.signature)).toBe(false);
  // Another key's signature doesn't verify with this install's key.
  expect(verifies(makeKeys().publicKeyB64, `windows|amd64|0.6.0|${p.sha256}`, res.body.signature)).toBe(false);
  // The heartbeat says so too.
  const hb = await client.post(HB, { agentVersion: '0.5.0' });
  expect(hb.body.update).toEqual(res.body);
});

it('an equal or older version, or no package at all, is 204 and the heartbeat offers nothing', async () => {
  const { client } = await enroll({ agentVersion: '0.6.0' });
  expect((await client.get(UPDATE)).status).toBe(204);
  publish([pkg('0.6.0'), pkg('0.6.0-rc.2'), pkg('0.5.9')]);
  expect((await client.get(UPDATE)).status).toBe(204);
  expect((await client.post(HB, { agentVersion: '0.6.0' })).body).toEqual({ update: null });
});

it('a missing or altered package is a 404 with nothing signed; the heartbeat carries on', async () => {
  const { client } = await enroll();
  const p = pkg('0.6.0');
  publish([p]);
  fs.writeFileSync(path.join(dist, p.file), 'tampered');
  const res = await client.get(UPDATE);
  expect(res.status).toBe(404);
  expect(res.body.signature).toBeUndefined();
  fs.rmSync(path.join(dist, p.file));
  expect((await client.get(UPDATE)).status).toBe(404);
  expect((await client.get(DOWNLOAD)).status).toBe(404);
  const hb = await client.post(HB, { agentVersion: '0.5.0' });
  expect(hb.status).toBe(200);
  expect(hb.body.update).toBeNull();
});

it('a manifest naming a file outside the packages folder is ignored', async () => {
  const { client } = await enroll();
  const p = pkg('0.6.0');
  publish([{ ...p, version: '0.8.0', file: '../manifest.json' }, { ...p, version: '0.9.0', file: '/etc/passwd' }]);
  expect((await client.get(UPDATE)).status).toBe(204);
});

it('the download streams the package only to a signed device request', async () => {
  const { client } = await enroll();
  const data = crypto.randomBytes(4096);
  const p = pkg('0.6.0', { bytes: data });
  publish([p]);
  const res = await client.get(DOWNLOAD).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers['x-prism-sha256']).toBe(p.sha256);
  expect(res.headers['x-prism-version']).toBe('0.6.0');
  expect(Buffer.compare(res.body, data)).toBe(0);
  expect((await request(getApp()).get(DOWNLOAD)).status).toBe(401);
  expect((await request(getApp()).get(UPDATE)).status).toBe(401);
  // A revoked device gets nothing.
  await models.Device.update({ revokedAt: new Date() }, { where: { id: client.deviceId } });
  expect((await client.get(DOWNLOAD)).status).toBe(401);
});

it('versions compare by number, with a pre-release before its release', () => {
  expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
  expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
  expect(compareVersions('dev', '0.1.0')).toBe(-1);
  // Branch builds: 0.0.0-dev.<CI run>, so run 10 is newer than run 9.
  expect(compareVersions('0.0.0-dev.10', '0.0.0-dev.9')).toBe(1);
  expect(compareVersions('0.0.0-dev.9', '0.0.0-dev.10')).toBe(-1);
  expect(compareVersions('0.0.0-dev.10', '0.5.0')).toBe(-1);
  expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1.1')).toBe(-1);
  expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
});

it('the shared update-signing vector holds in Node (the Go agent checks the same file)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../agent/testdata/update-signing.json'), 'utf8'));
  expect(sha(Buffer.from(v.packageText))).toBe(v.sha256);
  const text = signedText({ platform: v.platform, arch: v.arch, version: v.version, sha256: v.sha256 });
  expect(text).toBe(v.signedText);
  const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(v.seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  expect(crypto.sign(null, Buffer.from(text), key).toString('base64')).toBe(v.signatureB64);
  expect(verifies(v.publicKeyB64, text, v.signatureB64)).toBe(true);
});
