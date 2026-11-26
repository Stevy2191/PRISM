'use strict';

// Timesheets (Phase 3, step 3): each person's week of logged time,
// submitted and approved (or sent back with a note). A submitted or
// approved week locks its time to its owner. Plus the timesheet
// notifications (due, submitted, sent back).

const NEW_NOTIFICATIONS = ['timesheet_due', 'timesheet_submitted', 'timesheet_rejected'];
const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

async function enumValues(qi) {
  const [rows] = await qi.sequelize.query("SHOW COLUMNS FROM `Notifications` LIKE 'type'");
  const type = rows && rows[0] ? String(rows[0].Type) : '';
  return [...type.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
async function setEnum(qi, values) {
  await qi.sequelize.query(`ALTER TABLE \`Notifications\` MODIFY \`type\` ENUM(${values.map((v) => `'${v}'`).join(',')}) NOT NULL`);
}
// A saved notifications.enabledTypes allow-list would otherwise keep them off.
async function updateEnabledTypes(qi, Sequelize, change) {
  const [row] = await qi.sequelize.query("SELECT value FROM SystemSettings WHERE `key` = 'notifications.enabledTypes'", { type: Sequelize.QueryTypes.SELECT });
  let list;
  try { list = JSON.parse(row && row.value); } catch { list = null; }
  if (!Array.isArray(list)) return;
  await qi.sequelize.query("UPDATE SystemSettings SET value = ? WHERE `key` = 'notifications.enabledTypes'", { replacements: [JSON.stringify(change(list))] });
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    if (!(await tableNames(qi)).includes('Timesheets')) {
      await qi.createTable('Timesheets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: dt.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
        weekStart: { type: dt.DATEONLY, allowNull: false },
        status: { type: dt.ENUM('open', 'submitted', 'approved', 'rejected'), allowNull: false, defaultValue: 'open' },
        totalSeconds: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        submittedAt: { type: dt.DATE, allowNull: true },
        decidedAt: { type: dt.DATE, allowNull: true },
        decidedById: { type: dt.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
        note: { type: dt.STRING(1000), allowNull: true },
        remindedAt: { type: dt.DATE, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('Timesheets', ['userId', 'weekStart'], { unique: true, name: 'timesheets_user_week' });
      await qi.addIndex('Timesheets', ['status', 'weekStart'], { name: 'timesheets_status_week' });
    }
    const values = await enumValues(qi);
    const missing = NEW_NOTIFICATIONS.filter((v) => !values.includes(v));
    if (missing.length) await setEnum(qi, [...values, ...missing]);
    await updateEnabledTypes(qi, Sequelize, (list) => [...new Set([...list, ...NEW_NOTIFICATIONS])]);
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    await updateEnabledTypes(qi, Sequelize, (list) => list.filter((x) => !NEW_NOTIFICATIONS.includes(x)));
    await qi.sequelize.query('DELETE FROM Notifications WHERE type IN (:v)', { replacements: { v: NEW_NOTIFICATIONS } });
    const values = await enumValues(qi);
    if (values.some((v) => NEW_NOTIFICATIONS.includes(v))) await setEnum(qi, values.filter((v) => !NEW_NOTIFICATIONS.includes(v)));
    if ((await tableNames(qi)).includes('Timesheets')) await qi.dropTable('Timesheets');
  },
};
