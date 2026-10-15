'use strict';

// Service desk 5a (email). Admin overrides of the code-defined email
// templates, a CC list per ticket, per-user signatures and email
// notification preferences, the one-off CC/BCC each reply used, the new
// inbound log actions (and an index to match replies by Message-ID) for mail a technician sends from their own mailbox.
// The new notification type new_in_queue (a ticket landing in a team's
// queue unassigned) joins the Notifications.type ENUM and, where an admin
// saved the list, notifications.enabledTypes — that list is an allow-list,
// so a type missing from it is silently off.

const BASE_LOG_ACTIONS = ['ticket_created', 'reply_added', 'ignored', 'failed'];
const NEW_LOG_ACTIONS = ['staff_reply_added', 'unverified_note', 'staff_ticket_created', 'staff_ticket_unverified'];
const BASE_NOTIFICATIONS = ['reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update', 'workflow', 'sla_warning', 'sla_breached'];
const NEW_NOTIFICATIONS = ['new_in_queue'];

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

async function enumValues(qi, table, column) {
  const [rows] = await qi.sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`);
  const type = rows && rows[0] ? String(rows[0].Type) : '';
  const values = [...type.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (!/^enum\(/i.test(type) || !values.length) throw new Error(`Could not read the ENUM values of ${table}.${column}`);
  return values;
}

// Rewrites an ENUM's value list. `base` is always kept, so a value already
// in use can never be dropped by a list that happened to miss it.
async function changeEnum(qi, table, column, base, change) {
  const current = await enumValues(qi, table, column);
  const next = change([...new Set([...base, ...current])]);
  await qi.sequelize.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${next.map((v) => `'${v}'`).join(',')}) NOT NULL`);
}

async function updateEnabledTypes(qi, Sequelize, change) {
  const [row] = await qi.sequelize.query(
    "SELECT value FROM SystemSettings WHERE `key` = 'notifications.enabledTypes'",
    { type: Sequelize.QueryTypes.SELECT }
  );
  let list;
  try { list = JSON.parse(row && row.value); } catch { list = null; }
  if (!Array.isArray(list)) return;
  await qi.sequelize.query(
    "UPDATE SystemSettings SET value = ? WHERE `key` = 'notifications.enabledTypes'",
    { replacements: [JSON.stringify(change(list))] }
  );
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const tables = await tableNames(qi);

    if (!tables.includes('EmailTemplates')) {
      await qi.createTable('EmailTemplates', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        key: { type: dt.STRING(64), allowNull: false, unique: true },
        subject: { type: dt.STRING(255), allowNull: false },
        bodyHtml: { type: dt.TEXT, allowNull: false },
        enabled: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        updatedById: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('TicketCcs')) {
      await qi.createTable('TicketCcs', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: {
          type: dt.INTEGER, allowNull: false, references: { model: 'Tickets', key: 'id' }, onDelete: 'CASCADE',
        },
        email: { type: dt.STRING(255), allowNull: false },
        contactId: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Contacts', key: 'id' }, onDelete: 'SET NULL',
        },
        addedById: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TicketCcs', ['ticketId', 'email'], { unique: true, name: 'ticket_ccs_ticket_email' });
    }

    const users = await qi.describeTable('Users');
    if (!users.emailSignature) await qi.addColumn('Users', 'emailSignature', { type: dt.TEXT, allowNull: true });
    if (!users.notificationEmailPrefs) await qi.addColumn('Users', 'notificationEmailPrefs', { type: dt.JSON, allowNull: true });

    const comments = await qi.describeTable('Comments');
    if (!comments.emailCc) await qi.addColumn('Comments', 'emailCc', { type: dt.JSON, allowNull: true });
    if (!comments.emailBcc) await qi.addColumn('Comments', 'emailBcc', { type: dt.JSON, allowNull: true });
    if (!comments.viaEmail) await qi.addColumn('Comments', 'viaEmail', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });

    // Replies are matched to the ticket an earlier email was filed on.
    const logIndexes = await qi.showIndex('EmailProcessingLogs');
    if (!logIndexes.some((i) => i.name === 'email_logs_message_id')) {
      await qi.addIndex('EmailProcessingLogs', ['messageId'], { name: 'email_logs_message_id' });
    }
    await changeEnum(qi, 'EmailProcessingLogs', 'action', BASE_LOG_ACTIONS, (v) => [...new Set([...v, ...NEW_LOG_ACTIONS])]);
    await changeEnum(qi, 'Notifications', 'type', BASE_NOTIFICATIONS, (v) => [...new Set([...v, ...NEW_NOTIFICATIONS])]);
    await updateEnabledTypes(qi, Sequelize, (list) => [...new Set([...list, ...NEW_NOTIFICATIONS])]);
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    // Rows using the removed values would block the ENUM change; they have
    // no meaning without this migration's features.
    await qi.sequelize.query('DELETE FROM EmailProcessingLogs WHERE action IN (:v)', { replacements: { v: NEW_LOG_ACTIONS } });
    await qi.sequelize.query('DELETE FROM Notifications WHERE type IN (:v)', { replacements: { v: NEW_NOTIFICATIONS } });
    await changeEnum(qi, 'EmailProcessingLogs', 'action', [], (v) => v.filter((x) => !NEW_LOG_ACTIONS.includes(x)));
    if ((await qi.showIndex('EmailProcessingLogs')).some((i) => i.name === 'email_logs_message_id')) {
      await qi.removeIndex('EmailProcessingLogs', 'email_logs_message_id');
    }
    await changeEnum(qi, 'Notifications', 'type', [], (v) => v.filter((x) => !NEW_NOTIFICATIONS.includes(x)));
    await updateEnabledTypes(qi, Sequelize, (list) => list.filter((x) => !NEW_NOTIFICATIONS.includes(x)));

    const comments = await qi.describeTable('Comments');
    for (const col of ['viaEmail', 'emailBcc', 'emailCc']) {
      if (comments[col]) await qi.removeColumn('Comments', col); // eslint-disable-line no-await-in-loop
    }
    const users = await qi.describeTable('Users');
    for (const col of ['notificationEmailPrefs', 'emailSignature']) {
      if (users[col]) await qi.removeColumn('Users', col); // eslint-disable-line no-await-in-loop
    }
    const tables = await tableNames(qi);
    if (tables.includes('TicketCcs')) await qi.dropTable('TicketCcs');
    if (tables.includes('EmailTemplates')) await qi.dropTable('EmailTemplates');
  },
};
