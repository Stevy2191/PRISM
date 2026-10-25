'use strict';

// Project management (sub-project 6). Phases, task dependencies, helpers on
// tasks (Tasks.assigneeId stays the main assignee), a start date and an hour
// budget on projects, and four notification types with a project link.
// Hour budgets are stored as minutes (null = none); every date is DATEONLY.

const BASE_NOTIFICATIONS = ['reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update', 'workflow', 'sla_warning', 'sla_breached', 'new_in_queue', 'recurring_paused', 'virus_blocked', 'scanner_unavailable'];
const NEW_NOTIFICATIONS = ['task_unblocked', 'task_added', 'budget_warning', 'budget_reached'];

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

// A saved notifications.enabledTypes allow-list would otherwise keep the
// new types off (as migrations 063 and 066 did for theirs).
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
    const fk = (model, onDelete, allowNull = true) => ({ type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onDelete });
    const has = async (table, column) => Boolean((await qi.describeTable(table))[column]);

    if (!(await tableNames(qi)).includes('ProjectPhases')) {
      await qi.createTable('ProjectPhases', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        projectId: fk('Projects', 'CASCADE', false),
        name: { type: dt.STRING(100), allowNull: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        hourBudgetMinutes: { type: dt.INTEGER, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('ProjectPhases', ['projectId', 'position'], { name: 'project_phases_project_position' });
    }

    if (!(await has('Tasks', 'phaseId'))) await qi.addColumn('Tasks', 'phaseId', fk('ProjectPhases', 'SET NULL'));
    if (!(await has('Tasks', 'startDate'))) await qi.addColumn('Tasks', 'startDate', { type: dt.DATEONLY, allowNull: true });
    if (!(await has('Tasks', 'isMilestone'))) await qi.addColumn('Tasks', 'isMilestone', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });

    if (!(await tableNames(qi)).includes('TaskDependencies')) {
      await qi.createTable('TaskDependencies', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        predecessorId: fk('Tasks', 'CASCADE', false),
        successorId: fk('Tasks', 'CASCADE', false),
        createdBy: fk('Users', 'SET NULL'),
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TaskDependencies', ['predecessorId', 'successorId'], { unique: true, name: 'task_dependencies_pair' });
      await qi.addIndex('TaskDependencies', ['successorId'], { name: 'task_dependencies_successor' });
    }

    if (!(await tableNames(qi)).includes('TaskAssignees')) {
      await qi.createTable('TaskAssignees', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        taskId: fk('Tasks', 'CASCADE', false),
        userId: fk('Users', 'CASCADE', false),
        addedBy: fk('Users', 'SET NULL'),
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TaskAssignees', ['taskId', 'userId'], { unique: true, name: 'task_assignees_pair' });
      await qi.addIndex('TaskAssignees', ['userId'], { name: 'task_assignees_user' });
    }

    if (!(await has('Projects', 'startDate'))) await qi.addColumn('Projects', 'startDate', { type: dt.DATEONLY, allowNull: true });
    if (!(await has('Projects', 'hourBudgetMinutes'))) await qi.addColumn('Projects', 'hourBudgetMinutes', { type: dt.INTEGER, allowNull: true });
    // 0, 80 or 100: the highest budget alert already sent.
    if (!(await has('Projects', 'budgetAlertLevel'))) await qi.addColumn('Projects', 'budgetAlertLevel', { type: dt.TINYINT, allowNull: false, defaultValue: 0 });
    if (!(await has('Projects', 'budgetAlert80'))) await qi.addColumn('Projects', 'budgetAlert80', { type: dt.BOOLEAN, allowNull: false, defaultValue: true });
    if (!(await has('Projects', 'budgetAlert100'))) await qi.addColumn('Projects', 'budgetAlert100', { type: dt.BOOLEAN, allowNull: false, defaultValue: true });

    await changeEnum(qi, 'Notifications', 'type', BASE_NOTIFICATIONS, (v) => [...new Set([...v, ...NEW_NOTIFICATIONS])]);
    if (!(await has('Notifications', 'projectId'))) await qi.addColumn('Notifications', 'projectId', fk('Projects', 'CASCADE'));
    await updateEnabledTypes(qi, dt, (list) => [...new Set([...list, ...NEW_NOTIFICATIONS])]);

    // People added as a task helper become members with this role: they can
    // open the project and log time, but never count as editors.
    await changeEnum(qi, 'ProjectMembers', 'role', ['lead', 'member'], (v) => [...new Set([...v, 'helper'])], "NOT NULL DEFAULT 'member'");
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    // Helper rows become plain members (they keep their access).
    await qi.sequelize.query("UPDATE ProjectMembers SET role = 'member' WHERE role = 'helper'");
    await changeEnum(qi, 'ProjectMembers', 'role', ['lead', 'member'], (v) => v.filter((x) => x !== 'helper'), "NOT NULL DEFAULT 'member'");
    await updateEnabledTypes(qi, Sequelize, (list) => list.filter((x) => !NEW_NOTIFICATIONS.includes(x)));

    const has = async (table, column) => Boolean((await qi.describeTable(table))[column]);

    if (await has('Notifications', 'projectId')) await qi.removeColumn('Notifications', 'projectId');
    await qi.sequelize.query('DELETE FROM Notifications WHERE type IN (:v)', { replacements: { v: NEW_NOTIFICATIONS } });
    await changeEnum(qi, 'Notifications', 'type', [], (v) => v.filter((x) => !NEW_NOTIFICATIONS.includes(x)));

    for (const column of ['budgetAlert100', 'budgetAlert80', 'budgetAlertLevel', 'hourBudgetMinutes', 'startDate']) {
      if (await has('Projects', column)) await qi.removeColumn('Projects', column); // eslint-disable-line no-await-in-loop
    }

    for (const table of ['TaskAssignees', 'TaskDependencies']) {
      if ((await tableNames(qi)).includes(table)) await qi.dropTable(table); // eslint-disable-line no-await-in-loop
    }

    for (const column of ['isMilestone', 'startDate', 'phaseId']) {
      if (await has('Tasks', column)) await qi.removeColumn('Tasks', column); // eslint-disable-line no-await-in-loop
    }
    if ((await tableNames(qi)).includes('ProjectPhases')) await qi.dropTable('ProjectPhases');
  },
};
