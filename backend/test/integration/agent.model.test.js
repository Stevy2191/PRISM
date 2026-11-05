const Sequelize = require('sequelize');
const {
  resetData, closeDb, sequelize, models,
} = require('./helpers');
const { makeWorld, makeTicket, makeCompany } = require('./fixtures');
const migration = require('../../migrations/20260101000074-agent');
// Later migrations that add to the tables 074 makes: re-applied after its
// round trip, which recreates those tables without them.
const later = [require('../../migrations/20260101000077-device-scan-request')];

// Sub-project 8a, task 1: devices, enrollment keys, software, nonces, the
// agent ticket source and the devices.manage permission.

const qi = () => sequelize.getQueryInterface();
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const KEY = 'A'.repeat(43) + '=';

let w;
let company;
let asset;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Agent Co' });
  const category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  asset = await models.Asset.create({ assetTag: `AG-${Date.now()}`, name: 'PC-1', categoryId: category.id, companyId: company.id });
});
afterAll(closeDb);

const device = (fields = {}) => models.Device.create({
  assetId: asset.id, companyId: company.id, publicKey: KEY, platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'PC-1', ...fields,
});

it('one device per Asset; it goes with its Asset, and its nonces with it', async () => {
  const d = await device();
  await expect(device()).rejects.toThrow();
  await models.AgentNonce.create({ deviceId: d.id, nonce: 'n1', seenAt: new Date() });
  await expect(models.AgentNonce.create({ deviceId: d.id, nonce: 'n1', seenAt: new Date() })).rejects.toThrow();
  await models.AssetSoftware.create({ assetId: asset.id, name: 'Google Chrome', version: '130.0' });
  expect((await models.Asset.findByPk(asset.id, { include: ['device', 'software'] })).device.id).toBe(d.id);
  await asset.destroy();
  expect(await models.Device.count({ where: { id: d.id } })).toBe(0);
  expect(await models.AgentNonce.count({ where: { deviceId: d.id } })).toBe(0);
  expect(await models.AssetSoftware.count({ where: { assetId: asset.id } })).toBe(0);
});

it('an enrollment key keeps its hash out of reach and knows when it can be used', async () => {
  const key = await models.AgentEnrollmentKey.scope('withHash').create({
    companyId: company.id, name: 'Rollout', keyHash: 'f'.repeat(64), createdById: w.admin.user.id,
  });
  expect(key.isUsable()).toBe(true);
  expect((await models.AgentEnrollmentKey.findByPk(key.id)).toJSON()).not.toHaveProperty('keyHash');
  await key.update({ expiresAt: new Date(Date.now() - 1000) });
  expect(key.isUsable()).toBe(false);
  await key.update({ expiresAt: null, revokedAt: new Date() });
  expect(key.isUsable()).toBe(false);
  // Two keys can't share a hash.
  await expect(models.AgentEnrollmentKey.scope('withHash').create({ companyId: company.id, name: 'Dup', keyHash: 'f'.repeat(64) })).rejects.toThrow();
});

it('a ticket can come from the agent; devices.manage belongs to System Administrator only', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'From the tray', contactId: w.contact.id });
  await models.Ticket.update({ source: 'agent' }, { where: { id: t.id } });
  expect((await models.Ticket.findByPk(t.id)).source).toBe('agent');
  const holders = await select(
    `SELECT r.name FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` = 'devices.manage' AND rp.granted = 1 ORDER BY r.name`
  );
  expect(holders.map((h) => h.name)).toEqual(['System Administrator']);
});

it('round trip: down keeps tray tickets as manual ones and removes the tables; up puts them back', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'From the tray', contactId: w.contact.id });
  await models.Ticket.update({ source: 'agent' }, { where: { id: t.id } });
  await device();
  await migration.down(qi(), Sequelize);
  try {
    const tables = (await qi().showAllTables()).map((x) => (typeof x === 'string' ? x : x.tableName));
    expect(tables).not.toEqual(expect.arrayContaining(['Devices']));
    expect(tables).not.toContain('AgentEnrollmentKeys');
    expect(tables).not.toContain('AssetSoftware');
    expect((await select('SELECT source FROM Tickets WHERE id = ?', [t.id]))[0].source).toBe('manual');
    expect(await select("SELECT id FROM Permissions WHERE `key` = 'devices.manage'")).toHaveLength(0);
  } finally {
    await migration.up(qi(), Sequelize);
    for (const m of later) await m.up(qi(), Sequelize); // eslint-disable-line no-await-in-loop
  }
  await migration.up(qi(), Sequelize); // idempotent
  await models.Ticket.update({ source: 'agent' }, { where: { id: t.id } });
  expect((await models.Ticket.findByPk(t.id)).source).toBe('agent');
  expect(await select("SELECT id FROM Permissions WHERE `key` = 'devices.manage'")).toHaveLength(1);
});

it('the Manage devices permission says "enrollment" (078 fixes installs made before)', async () => {
  const spelling = require('../../migrations/20260101000078-enrollment-spelling');
  await sequelize.query("UPDATE Permissions SET description = 'Create and revoke agent enrolment keys, and revoke enrolled computers' WHERE `key` = 'devices.manage'");
  await spelling.up(qi(), Sequelize);
  const [row] = await select("SELECT description FROM Permissions WHERE `key` = 'devices.manage'");
  expect(row.description).toBe('Create and revoke agent enrollment keys, and revoke enrolled computers');
  await spelling.up(qi(), Sequelize); // nothing left to change
});
