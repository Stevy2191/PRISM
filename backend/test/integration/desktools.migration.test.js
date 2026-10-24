const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000066-service-desk-tools');
// 066's down drops RecurringTickets; up recreates it as 066 left it, without
// the columns later migrations add. Re-apply those (idempotent) afterwards so
// the next test files see the full schema.
const later = [require('../../migrations/20260101000068-ticket-categories')];
const { closedStatusName } = require('../../src/services/statusBehavior');
const { TicketStatus } = require('../../src/models');

// Service desk 5b schema: merge pointer, comment-linked attachments,
// canned responses, recurring tickets, two permissions, the Closed
// status's system key and the recurring_paused notification type.

const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const enumOf = async (table, column) => {
  const [row] = await select(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`);
  return [...String(row.Type).matchAll(/'([^']*)'/g)].map((m) => m[1]);
};

beforeEach(resetData);
afterAll(async () => {
  for (const m of later) await m.up(qi(), Sequelize); // eslint-disable-line no-await-in-loop
  await closeDb();
});

it('adds mergedIntoId, Attachments.commentId and the two tables', async () => {
  expect(await tables()).toEqual(expect.arrayContaining(['CannedResponses', 'RecurringTickets']));
  expect((await qi().describeTable('Tickets')).mergedIntoId).toBeDefined();
  expect((await qi().describeTable('Attachments')).commentId).toBeDefined();
  const canned = await qi().describeTable('CannedResponses');
  expect(Object.keys(canned)).toEqual(expect.arrayContaining(['title', 'body', 'visibility', 'ownerId', 'teamId']));
  const rec = await qi().describeTable('RecurringTickets');
  expect(Object.keys(rec)).toEqual(expect.arrayContaining([
    'title', 'description', 'priority', 'type', 'contactId', 'departmentId', 'teamId', 'assigneeId', 'tasks',
    'frequency', 'interval', 'weekdays', 'dayOfMonth', 'monthOfYear', 'timeOfDay', 'timezone', 'startDate', 'endDate',
    'nextRunAt', 'lastRunAt', 'lastTicketId', 'active', 'createdById', 'lastError',
  ]));
});

it('source enum accepts recurring', async () => {
  expect(await enumOf('Tickets', 'source')).toEqual(expect.arrayContaining(['manual', 'email', 'phone', 'portal', 'recurring']));
});

it('marks the protected Closed status with systemKey closed', async () => {
  const [row] = await select("SELECT systemKey FROM TicketStatuses WHERE name = 'Closed' AND isProtected = 1");
  expect(row.systemKey).toBe('closed');
});

it('grants both new permissions to System Administrator', async () => {
  const rows = await select(
    `SELECT p.\`key\` FROM Permissions p
       JOIN RolePermissions rp ON rp.permissionId = p.id AND rp.granted = 1
       JOIN Roles r ON r.id = rp.roleId
      WHERE r.name = 'System Administrator' AND p.\`key\` IN ('tickets.canned.manage', 'tickets.recurring.manage')`
  );
  expect(rows.map((r) => r.key).sort()).toEqual(['tickets.canned.manage', 'tickets.recurring.manage']);
});

it('adds recurring_paused to the Notifications enum and a stored enabledTypes list', async () => {
  expect(await enumOf('Notifications', 'type')).toContain('recurring_paused');
  await migration.down(qi(), Sequelize);
  await sequelize.query("INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES ('notifications.enabledTypes', '[\"assigned\"]', NOW())");
  await migration.up(qi(), Sequelize);
  const [row] = await select("SELECT value FROM SystemSettings WHERE `key` = 'notifications.enabledTypes'");
  expect(JSON.parse(row.value)).toEqual(['assigned', 'recurring_paused']);
});

it('down then up leaves the schema as the full chain does', async () => {
  await migration.down(qi(), Sequelize);
  expect(await tables()).not.toEqual(expect.arrayContaining(['CannedResponses']));
  expect(await tables()).not.toContain('RecurringTickets');
  expect((await qi().describeTable('Tickets')).mergedIntoId).toBeUndefined();
  expect((await qi().describeTable('Attachments')).commentId).toBeUndefined();
  expect(await enumOf('Tickets', 'source')).not.toContain('recurring');
  expect(await enumOf('Notifications', 'type')).not.toContain('recurring_paused');
  const [row] = await select("SELECT systemKey FROM TicketStatuses WHERE name = 'Closed' AND isProtected = 1");
  expect(row.systemKey).toBeNull();

  await migration.up(qi(), Sequelize);
  expect(await tables()).toEqual(expect.arrayContaining(['CannedResponses', 'RecurringTickets']));
  expect(await enumOf('Tickets', 'source')).toContain('recurring');
  const [again] = await select("SELECT systemKey FROM TicketStatuses WHERE name = 'Closed' AND isProtected = 1");
  expect(again.systemKey).toBe('closed');
});

describe('closedStatusName', () => {
  it('prefers systemKey closed, even after a rename, and falls back to the first closed kind', async () => {
    const closed = await TicketStatus.findOne({ where: { systemKey: 'closed' } });
    const original = closed.name;
    try {
      await closed.update({ name: 'Shut' });
      expect(await closedStatusName()).toBe('Shut');
      await closed.update({ systemKey: null });
      const first = await TicketStatus.findOne({ where: { behaviorType: 'closed' }, order: [['position', 'ASC']] });
      expect(await closedStatusName()).toBe(first.name);
    } finally {
      await closed.update({ name: original, systemKey: 'closed' });
    }
  });
});
