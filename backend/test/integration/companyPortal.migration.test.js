const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000092-company-portal');

// Migration 092 (CS part 3): one portal switch and one survey switch become
// each company's, and each company gets its own link.

const qi = () => sequelize.getQueryInterface();
const sel = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const run = (sql, replacements) => sequelize.query(sql, { replacements });

beforeEach(resetData);
afterAll(async () => {
  if (!(await qi().describeTable('Companies')).portalSlug) await migration.up(qi(), Sequelize);
  await resetData();
  await closeDb();
});

async function company(name) {
  await run("INSERT INTO Companies (name, isClient, isVendor, isInternal, status, createdAt, updatedAt) VALUES (?, 1, 0, 0, 'active', NOW(), NOW())", [name]);
  return (await sel('SELECT id FROM Companies WHERE name = ? ORDER BY id DESC LIMIT 1', [name]))[0].id;
}
const setting = (key, value) => run('INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value)', [key, value]);

it('keeps the portal on where someone could sign in, gives every company a link, and surveys their old switch', async () => {
  await migration.down(qi(), Sequelize);
  await setting('portal.enabled', 'true');
  await setting('csat.enabled', 'true');
  const withAccess = await company('Acme & Sons');
  const without = await company('Acme and Sons');
  await run("INSERT INTO Contacts (firstName, displayName, email, companyId, portalAccess, status, createdAt, updatedAt) VALUES ('Ann', 'Ann', 'ann@acme.example', ?, 1, 'active', NOW(), NOW())", [withAccess]);

  await migration.up(qi(), Sequelize);
  const rows = await sel('SELECT id, portalSlug, portalEnabled, csatEnabled FROM Companies WHERE id IN (?, ?) ORDER BY id', [withAccess, without]);
  expect(rows.map((r) => [r.portalSlug, !!r.portalEnabled, !!r.csatEnabled])).toEqual([
    ['acme-and-sons', true, true], ['acme-and-sons-2', false, true],
  ]);
  // Your own company: a link too; off while customers exist.
  const [own] = await sel('SELECT portalSlug, portalEnabled FROM Companies WHERE isInternal = 1');
  expect([typeof own.portalSlug, !!own.portalEnabled]).toEqual(['string', false]);
  expect(await sel("SELECT 1 FROM SystemSettings WHERE `key` IN ('portal.enabled', 'csat.enabled')")).toHaveLength(0);
});

it('with no customers and the portal on, your own company keeps it', async () => {
  await migration.down(qi(), Sequelize);
  await setting('portal.enabled', 'true');
  await migration.up(qi(), Sequelize);
  const [own] = await sel('SELECT portalEnabled, csatEnabled FROM Companies WHERE isInternal = 1');
  expect([!!own.portalEnabled, !!own.csatEnabled]).toEqual([true, false]);
});

it('rolls back to the two switches and re-applies', async () => {
  await run('UPDATE Companies SET portalEnabled = 1 WHERE isInternal = 1');
  await migration.down(qi(), Sequelize);
  expect((await qi().describeTable('Companies')).portalSlug).toBeUndefined();
  expect((await sel("SELECT value FROM SystemSettings WHERE `key` = 'portal.enabled'"))[0].value).toBe('true');
  await migration.up(qi(), Sequelize);
  await migration.up(qi(), Sequelize); // twice is harmless
  expect((await qi().describeTable('Companies')).portalSlug).toBeDefined();
});
