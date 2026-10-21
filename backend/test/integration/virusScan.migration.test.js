const Sequelize = require('sequelize');
const { resetData, closeDb, createUser, ROLE, sequelize, models } = require('./helpers');
const migration = require('../../migrations/20260101000067-virus-scanning');

const qi = () => sequelize.getQueryInterface();
const enumOf = async () => {
  const [rows] = await sequelize.query("SHOW COLUMNS FROM `Notifications` LIKE 'type'");
  return [...String(rows[0].Type).matchAll(/'([^']*)'/g)].map((m) => m[1]);
};

beforeEach(resetData);
afterAll(closeDb);

it('up adds both values; down removes them and their rows; up again restores', async () => {
  expect(await enumOf()).toEqual(expect.arrayContaining(['virus_blocked', 'scanner_unavailable', 'recurring_paused']));
  const { user } = await createUser({ username: 'mig-admin', roleName: ROLE.ADMIN });
  await models.Notification.create({ userId: user.id, type: 'virus_blocked', message: 'x' });
  await models.Notification.create({ userId: user.id, type: 'comment', message: 'keep' });
  await migration.down(qi(), Sequelize);
  expect(await enumOf()).not.toContain('virus_blocked');
  expect(await enumOf()).not.toContain('scanner_unavailable');
  expect(await enumOf()).toContain('recurring_paused');
  expect(await models.Notification.count()).toBe(1);
  await migration.up(qi(), Sequelize);
  expect(await enumOf()).toEqual(expect.arrayContaining(['virus_blocked', 'scanner_unavailable']));
});

it('does not touch a saved enabledTypes allow-list (these types are always on)', async () => {
  await sequelize.query("INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES ('notifications.enabledTypes', '[\"assigned\"]', NOW()) ON DUPLICATE KEY UPDATE value = '[\"assigned\"]'");
  await migration.down(qi(), Sequelize);
  await migration.up(qi(), Sequelize);
  const [rows] = await sequelize.query("SELECT value FROM SystemSettings WHERE `key` = 'notifications.enabledTypes'");
  expect(JSON.parse(rows[0].value)).toEqual(['assigned']);
});
