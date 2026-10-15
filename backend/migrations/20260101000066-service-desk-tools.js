'use strict';

// Service desk 5b (desk tools). Merge pointer on tickets, the comment an
// attachment arrived with (so a split can move just that comment's files),
// canned responses, recurring tickets, two permissions, a stable system key
// on the protected Closed status (bulk close and merge must not depend on
// its name), source 'recurring', and the recurring_paused notification type
// (also appended to a saved notifications.enabledTypes allow-list).

const BASE_SOURCES = ['manual', 'email', 'phone', 'portal'];
const NEW_SOURCES = ['recurring'];
const BASE_NOTIFICATIONS = ['reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update', 'workflow', 'sla_warning', 'sla_breached', 'new_in_queue'];
const NEW_NOTIFICATIONS = ['recurring_paused'];
const PERMISSIONS = [
  {
    key: 'tickets.canned.manage', category: 'tickets', label: 'Manage shared canned responses', description: 'Create and edit canned responses shared with a team or everyone',
  },
  {
    key: 'tickets.recurring.manage', category: 'tickets', label: 'Manage recurring tickets', description: 'Create, edit, pause and run recurring ticket rules',
  },
];

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
async function changeEnum(qi, table, column, base, change, extra = 'NOT NULL') {
  const current = await enumValues(qi, table, column);
  const next = change([...new Set([...base, ...current])]);
  await qi.sequelize.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${next.map((v) => `'${v}'`).join(',')}) ${extra}`);
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
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: dt.QueryTypes.SELECT, replacements });
    const tables = await tableNames(qi);
    const now = new Date();

    const tickets = await qi.describeTable('Tickets');
    if (!tickets.mergedIntoId) {
      await qi.addColumn('Tickets', 'mergedIntoId', {
        type: dt.INTEGER, allowNull: true, references: { model: 'Tickets', key: 'id' }, onDelete: 'SET NULL',
      });
    }
    const attachments = await qi.describeTable('Attachments');
    if (!attachments.commentId) {
      await qi.addColumn('Attachments', 'commentId', {
        type: dt.INTEGER, allowNull: true, references: { model: 'Comments', key: 'id' }, onDelete: 'SET NULL',
      });
    }
    await changeEnum(qi, 'Tickets', 'source', BASE_SOURCES, (v) => [...new Set([...v, ...NEW_SOURCES])], "NOT NULL DEFAULT 'manual'");

    if (!tables.includes('CannedResponses')) {
      await qi.createTable('CannedResponses', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: dt.STRING(200), allowNull: false },
        body: { type: dt.TEXT, allowNull: false },
        visibility: { type: dt.ENUM('personal', 'team', 'everyone'), allowNull: false, defaultValue: 'personal' },
        ownerId: {
          type: dt.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE',
        },
        teamId: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Teams', key: 'id' }, onDelete: 'CASCADE',
        },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('RecurringTickets')) {
      const ref = (model, onDelete, allowNull = true) => ({
        type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onDelete,
      });
      await qi.createTable('RecurringTickets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: dt.STRING(255), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        priority: { type: dt.STRING(20), allowNull: false, defaultValue: 'medium' },
        type: { type: dt.STRING(20), allowNull: false, defaultValue: 'request' },
        contactId: ref('Contacts', 'SET NULL'),
        departmentId: ref('Departments', 'SET NULL'),
        teamId: ref('Teams', 'SET NULL'),
        assigneeId: ref('Users', 'SET NULL'),
        tasks: { type: dt.JSON, allowNull: true },
        frequency: { type: dt.ENUM('daily', 'weekly', 'monthly', 'yearly'), allowNull: false },
        interval: { type: dt.INTEGER, allowNull: false, defaultValue: 1 },
        weekdays: { type: dt.JSON, allowNull: true },
        dayOfMonth: { type: dt.INTEGER, allowNull: true },
        monthOfYear: { type: dt.INTEGER, allowNull: true },
        timeOfDay: { type: dt.STRING(5), allowNull: false },
        timezone: { type: dt.STRING(64), allowNull: false },
        startDate: { type: dt.DATEONLY, allowNull: false },
        endDate: { type: dt.DATEONLY, allowNull: true },
        nextRunAt: { type: dt.DATE, allowNull: true },
        lastRunAt: { type: dt.DATE, allowNull: true },
        lastTicketId: ref('Tickets', 'SET NULL'),
        active: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        lastError: { type: dt.STRING(500), allowNull: true },
        createdById: ref('Users', 'CASCADE', false),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('RecurringTickets', ['active', 'nextRunAt'], { name: 'recurring_active_next' });
    }

    await qi.sequelize.query(
      "UPDATE TicketStatuses SET systemKey = 'closed' WHERE name = 'Closed' AND isProtected = 1 AND behaviorType = 'closed' AND systemKey IS NULL"
    );

    for (const perm of PERMISSIONS) {
      // eslint-disable-next-line no-await-in-loop
      const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: perm.key });
      // eslint-disable-next-line no-await-in-loop
      if (!existing) await qi.bulkInsert('Permissions', [{ ...perm, createdAt: now }]);
      // eslint-disable-next-line no-await-in-loop
      const [row] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: perm.key });
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query(
        `INSERT INTO RolePermissions (roleId, permissionId, granted)
         SELECT r.id, :pid, 1 FROM Roles r WHERE r.name = 'System Administrator'
           AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
        { replacements: { pid: row.id } }
      );
    }

    await changeEnum(qi, 'Notifications', 'type', BASE_NOTIFICATIONS, (v) => [...new Set([...v, ...NEW_NOTIFICATIONS])]);
    await updateEnabledTypes(qi, Sequelize, (list) => [...new Set([...list, ...NEW_NOTIFICATIONS])]);
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    await qi.sequelize.query('DELETE FROM Notifications WHERE type IN (:v)', { replacements: { v: NEW_NOTIFICATIONS } });
    await changeEnum(qi, 'Notifications', 'type', [], (v) => v.filter((x) => !NEW_NOTIFICATIONS.includes(x)));
    await updateEnabledTypes(qi, Sequelize, (list) => list.filter((x) => !NEW_NOTIFICATIONS.includes(x)));

    for (const perm of PERMISSIONS) {
      // eslint-disable-next-line no-await-in-loop
      const [row] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: perm.key });
      if (row) {
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: row.id } });
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: row.id } });
      }
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: perm.key } });
    }

    await qi.sequelize.query("UPDATE TicketStatuses SET systemKey = NULL WHERE systemKey = 'closed'");

    const tables = await tableNames(qi);
    if (tables.includes('RecurringTickets')) await qi.dropTable('RecurringTickets');
    if (tables.includes('CannedResponses')) await qi.dropTable('CannedResponses');

    // Tickets made by a recurring rule fall back to manual before the value goes.
    await qi.sequelize.query("UPDATE Tickets SET source = 'manual' WHERE source = 'recurring'");
    await changeEnum(qi, 'Tickets', 'source', BASE_SOURCES, (v) => v.filter((x) => !NEW_SOURCES.includes(x)), "NOT NULL DEFAULT 'manual'");

    const attachments = await qi.describeTable('Attachments');
    if (attachments.commentId) await qi.removeColumn('Attachments', 'commentId');
    const tickets = await qi.describeTable('Tickets');
    if (tickets.mergedIntoId) await qi.removeColumn('Tickets', 'mergedIntoId');
  },
};
