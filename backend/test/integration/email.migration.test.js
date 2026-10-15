const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000063-service-desk-email');

// Service desk 5a schema: email templates, ticket CC lists, signatures,
// email notification preferences and the new inbound log actions.

const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const enumOf = async (table, column) => {
  const [row] = await select(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`);
  return [...String(row.Type).matchAll(/'([^']*)'/g)].map((m) => m[1]);
};

beforeEach(resetData);
afterAll(closeDb);

it('creates the tables and columns', async () => {
  expect(await tables()).toEqual(expect.arrayContaining(['EmailTemplates', 'TicketCcs']));
  const tpl = await qi().describeTable('EmailTemplates');
  expect(Object.keys(tpl)).toEqual(expect.arrayContaining(['key', 'subject', 'bodyHtml', 'enabled', 'updatedById', 'createdAt', 'updatedAt']));
  const cc = await qi().describeTable('TicketCcs');
  expect(Object.keys(cc)).toEqual(expect.arrayContaining(['ticketId', 'email', 'contactId', 'addedById', 'createdAt']));
  expect(cc.updatedAt).toBeUndefined();
  const users = await qi().describeTable('Users');
  expect(users.emailSignature).toBeDefined();
  expect(users.notificationEmailPrefs).toBeDefined();
  const comments = await qi().describeTable('Comments');
  expect(comments.emailCc).toBeDefined();
  expect(comments.emailBcc).toBeDefined();
  expect(comments.viaEmail.defaultValue).toBe('0');
  expect(await enumOf('EmailProcessingLogs', 'action')).toEqual(expect.arrayContaining([
    'ticket_created', 'reply_added', 'ignored', 'failed',
    'staff_reply_added', 'unverified_note', 'staff_ticket_created', 'staff_ticket_unverified',
  ]));
  expect(await enumOf('Notifications', 'type')).toEqual(expect.arrayContaining(['sla_breached', 'new_in_queue']));
});

it('keeps one CC row per ticket and address', async () => {
  const [ticket] = await select("SELECT id FROM Companies WHERE isInternal = 1");
  await sequelize.query("INSERT INTO Tickets (title, status, priority, type, companyId, createdAt, updatedAt) VALUES ('t', 'Open', 'medium', 'request', ?, NOW(), NOW())", { replacements: [ticket.id] });
  const [{ id }] = await select('SELECT id FROM Tickets ORDER BY id DESC LIMIT 1');
  await sequelize.query("INSERT INTO TicketCcs (ticketId, email, createdAt) VALUES (?, 'a@x.com', NOW())", { replacements: [id] });
  await expect(sequelize.query("INSERT INTO TicketCcs (ticketId, email, createdAt) VALUES (?, 'a@x.com', NOW())", { replacements: [id] }))
    .rejects.toThrow(expect.objectContaining({ name: 'SequelizeUniqueConstraintError' }));
});

it('adds new_in_queue to a stored enabledTypes list', async () => {
  await migration.down(qi(), Sequelize);
  await sequelize.query("INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES ('notifications.enabledTypes', '[\"assigned\",\"comment\"]', NOW())");
  await migration.up(qi(), Sequelize);
  const [row] = await select("SELECT value FROM SystemSettings WHERE `key` = 'notifications.enabledTypes'");
  expect(JSON.parse(row.value)).toEqual(['assigned', 'comment', 'new_in_queue']);
});

it('round-trips (down then up)', async () => {
  await migration.down(qi(), Sequelize);
  expect(await tables()).not.toEqual(expect.arrayContaining(['EmailTemplates']));
  expect(await tables()).not.toContain('TicketCcs');
  expect((await qi().describeTable('Users')).emailSignature).toBeUndefined();
  expect((await qi().describeTable('Comments')).viaEmail).toBeUndefined();
  expect(await enumOf('EmailProcessingLogs', 'action')).toEqual(['ticket_created', 'reply_added', 'ignored', 'failed']);
  expect(await enumOf('Notifications', 'type')).not.toContain('new_in_queue');

  await migration.up(qi(), Sequelize);
  expect(await tables()).toEqual(expect.arrayContaining(['EmailTemplates', 'TicketCcs']));
  expect((await qi().describeTable('Comments')).viaEmail).toBeDefined();
  expect(await enumOf('Notifications', 'type')).toContain('new_in_queue');
});
