const fs = require('fs');
const path = require('path');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');
const { parseInventory } = require('../../src/services/agent/inventory');

// Sub-project 8a, task 4: inventory into Assets, software and the usual user.

const INV = '/api/v1/agent/v1/inventory';
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/agent', `${name}.json`), 'utf8'));
let w;
let company;
let other;
let device;
let assetId;

async function enrolled(target = company, extra = {}) {
  const res = await w.admin.agent.post(`/api/v1/companies/${target.id}/agent-keys`).send({ name: 'Rollout' });
  const client = await enrollDevice(getApp(), res.body.secret, extra);
  const d = await models.Device.findByPk(client.deviceId);
  return { client, assetId: d.assetId };
}
const asset = () => models.Asset.findByPk(assetId);
const contactIn = (c, email, extra = {}) => models.Contact.create({
  firstName: email.split('@')[0], displayName: email.split('@')[0], email, companyId: c.id, ...extra,
});

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  other = await makeCompany(w.admin, { name: 'Lakeside' });
  ({ client: device, assetId } = await enrolled());
});
afterAll(closeDb);

it('a Windows 11 inventory fills the Asset\'s own fields and the device detail', async () => {
  const res = await device.post(INV, fixture('windows11'));
  expect(res.status).toBe(200);
  expect(await asset()).toMatchObject({
    name: 'RFC-FD-01',
    make: 'Dell Inc.',
    model: 'OptiPlex 7010',
    serialNumber: '7XK4Q93',
    processor: '13th Gen Intel(R) Core(TM) i5-13500 (14 cores)',
    ram: '16 GB',
    // The USB backup drive isn't the computer's storage.
    storage: '476 GB (212 GB free)',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '24H2 (26100.2314)',
    firmwareVersion: '1.18.0',
    ipAddress: '10.20.1.45',
    macAddress: 'B0:7B:25:3E:91:0C',
  });
  const d = await models.Device.findByPk(device.deviceId);
  expect(d.inventory).toMatchObject({ domain: 'RIVERSIDE', lastBootAt: '2026-11-02T13:41:00.000Z' });
  expect(d.inventory.disks).toHaveLength(2);
  expect(d.lastInventoryAt).not.toBeNull();
  const sw = await models.AssetSoftware.findAll({ where: { assetId }, order: [['name', 'ASC']], raw: true });
  expect(sw.map((s) => s.name)).toEqual(['Adobe Acrobat Reader (64-bit)', 'Google Chrome', 'Microsoft 365 Apps for business - en-us', 'PRISM Agent']);
  expect(sw.find((s) => s.name === 'Google Chrome').installDate).toBe('2026-10-31');
  expect(res.body.software).toEqual({ added: 4, removed: 0 });
});

it('a Windows 10 inventory: duplicate programs collapse, a non-primary adapter gives the IP', async () => {
  await device.post(INV, fixture('windows10')).expect(200);
  expect(await asset()).toMatchObject({
    ram: '8 GB', operatingSystem: 'Windows 10 Pro', osVersion: '22H2 (19045.5011)', ipAddress: '192.168.10.23', macAddress: '8C:16:45:AA:01:7E',
  });
  expect(await models.AssetSoftware.count({ where: { assetId } })).toBe(1);
});

it('the agent overwrites its own fields but never the staff-owned ones', async () => {
  await device.post(INV, fixture('windows11')).expect(200);
  await models.Asset.update({ ram: '32 GB (staff guess)', locationRoom: 'Reception', notes: 'Front desk' }, { where: { id: assetId } });
  resetRateLimits();
  await device.post(INV, fixture('windows11')).expect(200);
  expect(await asset()).toMatchObject({ ram: '16 GB', locationRoom: 'Reception', notes: 'Front desk' });
  // A value the agent couldn't read doesn't blank the field.
  resetRateLimits();
  await device.post(INV, { ...fixture('windows11'), serialNumber: '' }).expect(200);
  expect((await asset()).serialNumber).toBe('7XK4Q93');
});

it('software is replaced, not appended', async () => {
  await device.post(INV, fixture('windows11')).expect(200);
  resetRateLimits();
  const inv = fixture('windows11');
  inv.software = [inv.software[1], { name: 'Zoom Workplace', version: '6.2.5', publisher: 'Zoom' }];
  const res = await device.post(INV, inv);
  expect(res.body.software).toEqual({ added: 1, removed: 3 });
  expect((await models.AssetSoftware.findAll({ where: { assetId }, raw: true })).map((s) => s.name).sort()).toEqual(['Google Chrome', 'Zoom Workplace']);
});

it('too many programs is refused; untrusted text is trimmed, cut and cleaned', async () => {
  const inv = fixture('windows11');
  inv.software = Array.from({ length: 5001 }, (_, i) => ({ name: `p${i}` }));
  expect((await device.post(INV, inv)).status).toBe(413);
  const p = parseInventory({
    hostname: `  ${'x'.repeat(400)}  `, make: 'Dell\u0000Inc', evil: { $where: 1 }, adapters: [{ name: 'e', ipv4: ['999.1.1.1', '10.0.0.1'], mac: 'not-a-mac' }],
  });
  expect(p.hostname).toHaveLength(255);
  expect(p.make).toBe('Dell Inc');
  expect(p).not.toHaveProperty('evil');
  expect(p.adapters[0]).toEqual({ name: 'e', ipv4: ['10.0.0.1'], mac: null, primary: false });
});

it('the signed-in user becomes the usual user, only within the Asset\'s company', async () => {
  // Same email in another company: never matched.
  await contactIn(other, 'someone@lakeside.test');
  const maria = await contactIn(company, 'maria.chen@riversideclinic.org');
  await device.post(INV, fixture('windows11')).expect(200);
  expect((await asset()).assignedToContactId).toBe(maria.id);

  const { client: theirs, assetId: theirAsset } = await enrolled(other, { hostname: 'LLG-1' });
  await theirs.post(INV, fixture('windows11')).expect(200);
  expect((await models.Asset.findByPk(theirAsset)).assignedToContactId).toBeNull();
});

it('a contact set by hand is kept; one the agent set follows the user', async () => {
  const maria = await contactIn(company, 'maria.chen@riversideclinic.org');
  const james = await contactIn(company, 'james.porter@riversideclinic.org');
  await device.post(INV, fixture('windows11')).expect(200);
  expect((await asset()).assignedToContactId).toBe(maria.id);
  // A different user signs in: the agent's own choice moves with them.
  resetRateLimits();
  const inv = fixture('windows11');
  inv.signedInUser = { account: 'RIVERSIDE\\jporter', upn: 'james.porter@riversideclinic.org' };
  await device.post(INV, inv).expect(200);
  expect((await asset()).assignedToContactId).toBe(james.id);
  // Staff set someone by hand: from now on the agent leaves it alone.
  await models.Asset.update({ assignedToContactId: maria.id }, { where: { id: assetId } });
  resetRateLimits();
  await device.post(INV, inv).expect(200);
  expect((await asset()).assignedToContactId).toBe(maria.id);
});

it('a signed-in user with no match leaves the assignment alone and creates nothing', async () => {
  const before = await models.Contact.count();
  await device.post(INV, fixture('windows10')).expect(200);
  expect((await asset()).assignedToContactId).toBeNull();
  expect(await models.Contact.count()).toBe(before);
});

it('is rate-limited per device and needs a valid device signature', async () => {
  const inv = fixture('windows10');
  for (let i = 0; i < 3; i += 1) expect((await device.post(INV, inv)).status).toBe(200); // eslint-disable-line no-await-in-loop
  expect((await device.post(INV, inv)).status).toBe(429);
  const request = require('supertest'); // eslint-disable-line global-require
  expect((await request(getApp()).post(INV).send(inv)).status).toBe(401);
});

it('a Mac inventory (8b): Apple, the model with its chip, macOS and its build, the internal disk only', async () => {
  const { client: mac, assetId: macAsset } = await enrolled(company, { platform: 'macos', arch: 'arm64', hostname: 'Dr-Patel-MacBook' });
  await mac.post(INV, fixture('macos15')).expect(200);
  expect(await models.Asset.findByPk(macAsset)).toMatchObject({
    make: 'Apple',
    model: 'MacBook Air (M3)',
    serialNumber: 'FVFG4P3XQ6LR',
    processor: 'Apple M3 (8 cores)',
    ram: '16 GB',
    // Thunderbolt and USB disks aren't the Mac's own storage.
    storage: '460 GB (212 GB free)',
    operatingSystem: 'macOS',
    osVersion: '15.1 (24B83)',
    ipAddress: '192.168.1.23',
  });
  expect(await models.AssetSoftware.count({ where: { assetId: macAsset } })).toBe(3);
});
