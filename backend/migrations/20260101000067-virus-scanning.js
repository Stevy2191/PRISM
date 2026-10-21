'use strict';

// Attachment virus scanning (5d). Two always-on admin notification types.
// They are deliberately NOT added to a saved notifications.enabledTypes
// allow-list: they bypass it, so admins can't switch security alerts off.

const BASE_NOTIFICATIONS = ['reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update', 'workflow', 'sla_warning', 'sla_breached', 'new_in_queue', 'recurring_paused'];
const NEW_NOTIFICATIONS = ['virus_blocked', 'scanner_unavailable'];

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

module.exports = {
  up: async (queryInterface) => {
    await changeEnum(queryInterface, 'Notifications', 'type', BASE_NOTIFICATIONS, (v) => [...new Set([...v, ...NEW_NOTIFICATIONS])]);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DELETE FROM Notifications WHERE type IN (:v)', { replacements: { v: NEW_NOTIFICATIONS } });
    await changeEnum(queryInterface, 'Notifications', 'type', [], (v) => v.filter((x) => !NEW_NOTIFICATIONS.includes(x)));
  },
};
