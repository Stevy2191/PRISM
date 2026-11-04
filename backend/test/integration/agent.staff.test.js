const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resetData, closeDb, models, getApp, sequelize,
} = require('./helpers');
const {
  makeWorld, makeCompany, makeTech, setCompanyAccess,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { enrollDevice } = require('./agentClient');

// Sub-project 8a, task 12: the staff side of the agent.

const API = '/api/v1';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
let w;
let company;
let other;
let dist;
const savedDist = process.env.AGENT_DIST_DIR;

async function enrolledIn(c, hostname, extra = {}) {
  const res = await w.admin.agent.post(`${API}/companies/${c.id}/agent-keys`).send({ name: `Key ${hostname}` });
  const client = await enrollDevice(getApp(), res.body.secret, { hostname, ...extra });
  return { client, device: await models.Device.findByPk(client.deviceId) };
}
const seen = (device, msAgo) => models.Device.update({ lastSeenAt: msAgo === null ? null : new Date(Date.now() - msAgo) }, { where: { id: device.id } });
async function grant(user, permissionKey, granted = true) {
  await sequelize.query(
    'INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt) VALUES (:u, :k, :g, NOW())',
    { replacements: { u: user.user.id, k: permissionKey, g: granted ? 1 : 0 } }
  );
  invalidateAllPermissions();
}

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dist-'));
  process.env.AGENT_DIST_DIR = dist;
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  other = await makeCompany(w.admin, { name: 'Lakeside' });
});
afterEach(() => fs.rmSync(dist, { recursive: true, force: true }));
afterAll(async () => {
  if (savedDist === undefined) delete process.env.AGENT_DIST_DIR; else process.env.AGENT_DIST_DIR = savedDist;
  await closeDb();
});

it('a company\'s devices: online, offline and stale, counts, filters, revoked kept apart', async () => {
  const { device: a } = await enrolledIn(company, 'RFC-FD-01');
  const { device: b } = await enrolledIn(company, 'RFC-BILL-03');
  const { device: c } = await enrolledIn(company, 'RFC-RAD-02');
  const { device: d } = await enrolledIn(company, 'RFC-OLD-09');
  await enrolledIn(other, 'LLG-1');
  await seen(a, 2 * MIN);
  await seen(b, 3 * 60 * MIN);
  await seen(c, 16 * DAY);
  await models.Device.update({ revokedAt: new Date() }, { where: { id: d.id } });
  const res = await w.admin.agent.get(`${API}/companies/${company.id}/devices`).expect(200);
  expect(res.body.counts).toEqual({
    all: 3, online: 1, offline: 1, stale: 1, revoked: 1,
  });
  expect(res.body.devices.map((x) => [x.hostname, x.status])).toEqual([['RFC-BILL-03', 'offline'], ['RFC-FD-01', 'online'], ['RFC-RAD-02', 'stale']]);
  const one = res.body.devices.find((x) => x.hostname === 'RFC-FD-01');
  expect(one.asset).toMatchObject({ id: a.assetId, assetTag: expect.any(String) });
  expect(one).not.toHaveProperty('publicKey');
  const stale = await w.admin.agent.get(`${API}/companies/${company.id}/devices?status=stale`).expect(200);
  expect(stale.body.devices.map((x) => x.hostname)).toEqual(['RFC-RAD-02']);
  const revoked = await w.admin.agent.get(`${API}/companies/${company.id}/devices?status=revoked`).expect(200);
  expect(revoked.body.devices.map((x) => x.hostname)).toEqual(['RFC-OLD-09']);
});

it('the Asset\'s device and software tabs; the Asset page carries the badges', async () => {
  const { client, device } = await enrolledIn(company, 'RFC-FD-01');
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/agent/windows11.json'), 'utf8'));
  await client.post(`${API}/agent/v1/inventory`, inv).expect(200);
  const det = await w.admin.agent.get(`${API}/assets/${device.assetId}/device`).expect(200);
  expect(det.body.device).toMatchObject({
    status: 'online', platform: 'windows', hostname: 'RFC-FD-01', domain: 'RIVERSIDE', enrollmentKey: { name: 'Key RFC-FD-01' },
  });
  expect(det.body.device.disks).toHaveLength(2);
  expect(det.body.device.adapters[0]).toMatchObject({ name: 'Ethernet', primary: true });
  expect(JSON.stringify(det.body)).not.toContain(device.publicKey);

  const page = await w.admin.agent.get(`${API}/assets/${device.assetId}`).expect(200);
  expect(page.body.device).toMatchObject({ status: 'online', softwareCount: 4 });
  expect(page.body.agentFields).toEqual(expect.arrayContaining(['serialNumber', 'operatingSystem']));

  const sw = await w.admin.agent.get(`${API}/assets/${device.assetId}/software?limit=2`).expect(200);
  expect(sw.body.software.map((s) => s.name)).toEqual(['Adobe Acrobat Reader (64-bit)', 'Google Chrome']);
  expect(sw.body).toMatchObject({ total: 4, programs: 4 });
  const found = await w.admin.agent.get(`${API}/assets/${device.assetId}/software?search=google`).expect(200);
  expect(found.body.software.map((s) => s.name)).toEqual(['Google Chrome']);
  expect(found.body).toMatchObject({ total: 1, programs: 4 });
  // LIKE wildcards in the search are literal.
  expect((await w.admin.agent.get(`${API}/assets/${device.assetId}/software?search=%25`).expect(200)).body.software).toHaveLength(0);

  // An Asset without the agent: no device, no agent fields.
  const plain = await models.Asset.create({ name: 'Printer', assetTag: 'PRN-1', categoryId: (await models.AssetCategory.findOne()).id, companyId: company.id });
  const p = await w.admin.agent.get(`${API}/assets/${plain.id}`).expect(200);
  expect(p.body.device).toBeNull();
  expect(p.body.agentFields).toEqual([]);
  expect((await w.admin.agent.get(`${API}/assets/${plain.id}/device`)).status).toBe(404);
});

it('devices and software respect company access and Assets\' view permission', async () => {
  const { device } = await enrolledIn(company, 'RFC-FD-01');
  const tech = await makeTech('tech-dev', w.deptA.id);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [other.id] });
  expect((await tech.agent.get(`${API}/companies/${company.id}/devices`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/assets/${device.assetId}/device`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/assets/${device.assetId}/software`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/companies/${other.id}/devices`)).status).toBe(200);
  // The Assets list's agent counts only count what the user can reach.
  expect((await tech.agent.get(`${API}/assets/agent-summary`).expect(200)).body).toEqual({
    all: 0, managed: 0, online: 0, stale: 0,
  });
  // No assets.view, no devices.
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: true, companyIds: [] });
  await grant(tech, 'assets.view', false);
  expect((await tech.agent.get(`${API}/companies/${company.id}/devices`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/assets/${device.assetId}/device`)).status).toBe(403);
});

it('revoking a computer needs devices.manage and its company in reach; it is refused at once', async () => {
  const { client, device } = await enrolledIn(company, 'RFC-FD-01');
  const tech = await makeTech('tech-rev', w.deptA.id);
  expect((await tech.agent.post(`${API}/devices/${device.id}/revoke`)).status).toBe(403);
  await grant(tech, 'devices.manage');
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [other.id] });
  expect((await tech.agent.post(`${API}/devices/${device.id}/revoke`)).status).toBe(403);
  expect((await client.post(`${API}/agent/v1/heartbeat`, { agentVersion: '0.5.0' })).status).toBe(200);

  const res = await w.admin.agent.post(`${API}/devices/${device.id}/revoke`).expect(200);
  expect(res.body.device.status).toBe('revoked');
  resetRateLimits();
  expect((await client.post(`${API}/agent/v1/heartbeat`, { agentVersion: '0.5.0' })).status).toBe(401);
  // The Asset and its history stay.
  expect(await models.Asset.findByPk(device.assetId)).not.toBeNull();
  expect(await models.AssetActivity.count({ where: { assetId: device.assetId, action: 'agent_revoked' } })).toBe(1);
  expect((await w.admin.agent.post(`${API}/devices/999999/revoke`)).status).toBe(404);
});

it('Scan now: the next heartbeat asks for an inventory, which clears it', async () => {
  const { client, device } = await enrolledIn(company, 'RFC-FD-01');
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/agent/windows11.json'), 'utf8'));
  // The heartbeat limit is per device and tight: reset it for each beat.
  const beat = async () => { resetRateLimits(); return (await client.post(`${API}/agent/v1/heartbeat`, { agentVersion: '0.5.0' }).expect(200)).body.scan; };
  expect(await beat()).toBe(false);

  // Staff who can edit Assets may ask, within their companies.
  const tech = await makeTech('tech-scan', w.deptA.id);
  await grant(tech, 'assets.edit', false);
  expect((await tech.agent.post(`${API}/devices/${device.id}/scan`)).status).toBe(403);
  await grant(tech, 'assets.edit');
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [other.id] });
  expect((await tech.agent.post(`${API}/devices/${device.id}/scan`)).status).toBe(403);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: true, companyIds: [] });

  const asked = (await tech.agent.post(`${API}/devices/${device.id}/scan`).expect(200)).body.device;
  expect(asked.scanRequestedAt).toBeTruthy();
  // Asking again while one is pending changes nothing.
  const again = (await tech.agent.post(`${API}/devices/${device.id}/scan`).expect(200)).body.device;
  const sec = (t) => Math.floor(Date.parse(t) / 1000);
  expect(sec(again.scanRequestedAt)).toBe(sec(asked.scanRequestedAt));
  expect(await models.AssetActivity.count({ where: { assetId: device.assetId, action: 'agent_scan_requested' } })).toBe(1);
  // It shows on the Devices tab and the Asset's device.
  const list = (await w.admin.agent.get(`${API}/companies/${company.id}/devices`).expect(200)).body.devices;
  expect(list[0].scanRequestedAt).toBeTruthy();
  expect((await w.admin.agent.get(`${API}/assets/${device.assetId}/device`).expect(200)).body.device.scanRequestedAt).toBeTruthy();

  expect(await beat()).toBe(true);
  expect(await beat()).toBe(true); // until the inventory arrives
  resetRateLimits();
  await client.post(`${API}/agent/v1/inventory`, inventory).expect(200);
  expect(await beat()).toBe(false);
  expect((await models.Device.findByPk(device.id)).scanRequestedAt).toBeNull();

  // Not for a revoked computer, nor one that doesn't exist.
  await models.Device.update({ revokedAt: new Date() }, { where: { id: device.id } });
  expect((await w.admin.agent.post(`${API}/devices/${device.id}/scan`)).body.code).toBe('DEVICE_REVOKED');
  expect((await w.admin.agent.post(`${API}/devices/999999/scan`)).status).toBe(404);
});

it('the Assets list: Online status per row, agent filters and counts', async () => {
  const { device: a } = await enrolledIn(company, 'RFC-FD-01');
  const { device: b } = await enrolledIn(company, 'RFC-RAD-02');
  await seen(a, MIN);
  await seen(b, 20 * DAY);
  await models.Asset.create({ name: 'Printer', assetTag: 'PRN-1', categoryId: (await models.AssetCategory.findOne()).id, companyId: company.id });
  const all = await w.admin.agent.get(`${API}/assets?limit=50`).expect(200);
  const byName = Object.fromEntries(all.body.assets.map((x) => [x.name, x]));
  expect(byName['RFC-FD-01'].device).toMatchObject({ status: 'online' });
  expect(byName['RFC-RAD-02'].device).toMatchObject({ status: 'stale' });
  expect(byName.Printer.device).toBeNull();
  expect(byName['RFC-FD-01'].device).not.toHaveProperty('publicKey');
  const names = async (q) => (await w.admin.agent.get(`${API}/assets?${q}`).expect(200)).body.assets.map((x) => x.name).sort();
  expect(await names('agent=managed')).toEqual(['RFC-FD-01', 'RFC-RAD-02']);
  expect(await names('agent=online')).toEqual(['RFC-FD-01']);
  expect(await names('agent=stale')).toEqual(['RFC-RAD-02']);
  expect((await w.admin.agent.get(`${API}/assets/agent-summary?companyId=${company.id}`).expect(200)).body).toEqual({
    all: 3, managed: 2, online: 1, stale: 1,
  });
});

it('installers: listed and downloaded by staff with devices.manage only', async () => {
  const bytes = crypto.randomBytes(2048);
  const file = 'prism-agent-0.6.0-windows-amd64.msi';
  fs.writeFileSync(path.join(dist, file), bytes);
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify([{
    platform: 'windows', arch: 'amd64', version: '0.6.0', file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }]));
  const list = await w.admin.agent.get(`${API}/devices/packages`).expect(200);
  expect(list.body.packages).toEqual([{
    platform: 'windows', arch: 'amd64', arches: ['amd64'], universal: false, version: '0.6.0', size: 2048, file,
  }]);
  const dl = await w.admin.agent.get(`${API}/devices/packages/windows/amd64`).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(dl.status).toBe(200);
  expect(dl.headers['content-disposition']).toContain(file);
  expect(Buffer.compare(dl.body, bytes)).toBe(0);
  expect((await w.admin.agent.get(`${API}/devices/packages/macos/arm64`)).status).toBe(404);
  expect((await w.admin.agent.get(`${API}/devices/packages/..%2F..%2Fetc/amd64`)).status).toBe(404);
  const tech = await makeTech('tech-dl', w.deptA.id);
  expect((await tech.agent.get(`${API}/devices/packages`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/devices/packages/windows/amd64`)).status).toBe(403);
  // Not signed in: nothing.
  const request = require('supertest'); // eslint-disable-line global-require
  expect((await request(getApp()).get(`${API}/devices/packages/windows/amd64`)).status).toBe(401);
});

it('the Mac\'s universal package (8b) is listed once and downloads for either chip', async () => {
  const bytes = crypto.randomBytes(4096);
  const file = 'prism-agent-0.6.0-macos-universal.pkg';
  fs.writeFileSync(path.join(dist, file), bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(['amd64', 'arm64'].map((arch) => ({
    platform: 'macos', arch, version: '0.6.0', file, sha256,
  }))));
  const list = await w.admin.agent.get(`${API}/devices/packages`).expect(200);
  expect(list.body.packages).toEqual([{
    platform: 'macos', arch: 'amd64', arches: ['amd64', 'arm64'], universal: true, version: '0.6.0', size: 4096, file,
  }]);
  for (const arch of ['amd64', 'arm64']) {
    // eslint-disable-next-line no-await-in-loop
    const dl = await w.admin.agent.get(`${API}/devices/packages/macos/${arch}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain(file);
  }
});
