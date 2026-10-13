'use strict';

// SLA engine (sub-project 4). The old SlaPolicies table held one row per
// priority and nothing read it. It becomes named policies (one default),
// each with per-priority targets for three clocks, plus one TicketSlas row
// per ticket holding the clock state. Companies can carry their own policy;
// ticket statuses can pause the resolution clock; workflow rules gain two
// SLA triggers and a "set SLA policy" action.
const CLOCKS = ['assign', 'response', 'resolution'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const NEW_TRIGGERS = ['sla_warning', 'sla_breached'];
const NEW_ACTIONS = ['set_sla_policy'];
// The values these columns hold before this migration, where they are
// ENUMs. Rewriting an ENUM with a list that misses a value in use would
// corrupt those rows, so the lists are always a superset of these.
const BASE_TRIGGERS = [
  'ticket_created', 'ticket_updated', 'ticket_status_changed', 'ticket_priority_changed',
  'ticket_assigned', 'ticket_comment_added', 'ticket_due_date_approaching', 'ticket_overdue', 'ticket_closed',
];
const NEW_NOTIFICATIONS = ['sla_warning', 'sla_breached'];
const BASE_NOTIFICATIONS = ['reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update', 'workflow'];
const BASE_ACTIONS = [
  'assign_to_user', 'assign_to_team', 'assign_round_robin', 'set_status', 'set_priority',
  'add_tag', 'remove_tag', 'set_due_date', 'send_notification', 'add_private_comment', 'escalate_to_user',
];
// The values migration 20260101000036 seeded, for an install with no rows.
const SEED = {
  critical: [1, 4, false], high: [4, 8, true], medium: [8, 24, true], low: [24, 72, true],
};

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

// The column's ENUM values, or null when it isn't an ENUM. Migration 026
// created WorkflowRules.triggerEvent and WorkflowActions.actionType as
// VARCHAR(50) (only the models say ENUM); those already take any value and
// are left alone. Notifications.type is a real ENUM (migration 006).
async function enumValues(qi, table, column) {
  const [rows] = await qi.sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`);
  const type = rows && rows[0] ? String(rows[0].Type) : '';
  if (!/^enum\(/i.test(type)) return null;
  const values = [...type.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (!values.length) throw new Error(`Could not read the ENUM values of ${table}.${column}`);
  return values;
}

// Rewrites an ENUM column's value list; a non-ENUM column is left as it is.
async function changeEnum(qi, table, column, change) {
  const current = await enumValues(qi, table, column);
  if (!current) return;
  const list = change(current).map((v) => `'${v}'`).join(',');
  await qi.sequelize.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${list}) NOT NULL`);
}

async function dropForeignKeys(qi, table, column) {
  const refs = await qi.getForeignKeyReferencesForTable(table);
  for (const ref of refs.filter((r) => r.columnName === column)) {
    await qi.removeConstraint(table, ref.constraintName); // eslint-disable-line no-await-in-loop
  }
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

function clockColumns(Sequelize) {
  const cols = {};
  CLOCKS.forEach((c) => {
    cols[`${c}TargetMinutes`] = { type: Sequelize.INTEGER, allowNull: true };
    cols[`${c}UsedMinutes`] = { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 };
    ['RunningSince', 'DueAt', 'WarnAt', 'WarnedAt', 'BreachedAt', 'MetAt'].forEach((s) => {
      cols[`${c}${s}`] = { type: Sequelize.DATE, allowNull: true };
    });
  });
  return cols;
}

module.exports = {
  CLOCKS,
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const old = (await tableNames(qi)).includes('SlaPolicies')
      ? await qi.sequelize.query('SELECT priority, firstResponseHours, resolutionHours, useBusinessHours FROM SlaPolicies', { type: Sequelize.QueryTypes.SELECT })
      : [];
    if (old.length || (await tableNames(qi)).includes('SlaPolicies')) await qi.dropTable('SlaPolicies');

    await qi.createTable('SlaPolicies', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: dt.STRING(100), allowNull: false, unique: true },
      isDefault: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
      businessHoursId: {
        type: dt.INTEGER, allowNull: true, references: { model: 'BusinessHours', key: 'id' }, onDelete: 'SET NULL',
      },
      warnAtPercent: { type: dt.INTEGER, allowNull: false, defaultValue: 75 },
      createdAt: { type: dt.DATE, allowNull: false },
      updatedAt: { type: dt.DATE, allowNull: false },
    });
    await qi.createTable('SlaTargets', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      slaPolicyId: {
        type: dt.INTEGER, allowNull: false, references: { model: 'SlaPolicies', key: 'id' }, onDelete: 'CASCADE',
      },
      priority: { type: dt.ENUM(...PRIORITIES), allowNull: false },
      assignMinutes: { type: dt.INTEGER, allowNull: true },
      responseMinutes: { type: dt.INTEGER, allowNull: true },
      resolutionMinutes: { type: dt.INTEGER, allowNull: true },
      useBusinessHours: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: dt.DATE, allowNull: false },
      updatedAt: { type: dt.DATE, allowNull: false },
    });
    await qi.addIndex('SlaTargets', ['slaPolicyId', 'priority'], { unique: true, name: 'sla_targets_policy_priority' });

    const [globalHours] = await qi.sequelize.query(
      'SELECT id FROM BusinessHours WHERE departmentId IS NULL ORDER BY id LIMIT 1',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const now = new Date();
    await qi.bulkInsert('SlaPolicies', [{
      name: 'Standard', isDefault: true, businessHoursId: globalHours ? globalHours.id : null, warnAtPercent: 75, createdAt: now, updatedAt: now,
    }]);
    const [std] = await qi.sequelize.query("SELECT id FROM SlaPolicies WHERE name = 'Standard'", { type: Sequelize.QueryTypes.SELECT });
    const byPriority = new Map(old.map((r) => [r.priority, r]));
    await qi.bulkInsert('SlaTargets', PRIORITIES.map((p) => {
      const r = byPriority.get(p);
      const [resp, resol, biz] = r ? [Number(r.firstResponseHours), Number(r.resolutionHours), !!r.useBusinessHours] : SEED[p];
      return {
        slaPolicyId: std.id, priority: p, assignMinutes: null, responseMinutes: Math.round(resp * 60),
        resolutionMinutes: Math.round(resol * 60), useBusinessHours: biz, createdAt: now, updatedAt: now,
      };
    }));

    await qi.createTable('TicketSlas', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: {
        type: dt.INTEGER, allowNull: false, unique: true, references: { model: 'Tickets', key: 'id' }, onDelete: 'CASCADE',
      },
      slaPolicyId: { type: dt.INTEGER, allowNull: false, references: { model: 'SlaPolicies', key: 'id' } },
      priority: { type: dt.ENUM(...PRIORITIES), allowNull: false },
      ...clockColumns(dt),
      createdAt: { type: dt.DATE, allowNull: false },
      updatedAt: { type: dt.DATE, allowNull: false },
    });
    for (const c of CLOCKS) {
      await qi.addIndex('TicketSlas', [`${c}DueAt`], { name: `ticket_slas_${c}_due` }); // eslint-disable-line no-await-in-loop
      await qi.addIndex('TicketSlas', [`${c}WarnAt`], { name: `ticket_slas_${c}_warn` }); // eslint-disable-line no-await-in-loop
    }

    await qi.addColumn('Companies', 'slaPolicyId', {
      type: dt.INTEGER, allowNull: true, references: { model: 'SlaPolicies', key: 'id' }, onDelete: 'SET NULL',
    });
    await qi.addColumn('TicketStatuses', 'pausesSla', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });

    const union = (...lists) => [...new Set(lists.flat())];
    await changeEnum(qi, 'WorkflowRules', 'triggerEvent', (cur) => union(BASE_TRIGGERS, cur, NEW_TRIGGERS));
    await changeEnum(qi, 'WorkflowActions', 'actionType', (cur) => union(BASE_ACTIONS, cur, NEW_ACTIONS));
    await changeEnum(qi, 'Notifications', 'type', (cur) => union(BASE_NOTIFICATIONS, cur, NEW_NOTIFICATIONS));
    // A saved notification setting is an allow-list: without this the new
    // SLA notifications would be off on every install that ever saved it.
    await updateEnabledTypes(qi, Sequelize, (list) => union(list, NEW_NOTIFICATIONS));
  },

  // Back to one row per priority, taken from the default policy's targets.
  // Other policies, ticket clocks and SLA workflow rules are removed.
  down: async (queryInterface, Sequelize = require('sequelize')) => { // eslint-disable-line global-require
    const qi = queryInterface;
    const dt = Sequelize;
    const targets = await qi.sequelize.query(
      'SELECT t.priority, t.responseMinutes, t.resolutionMinutes, t.useBusinessHours FROM SlaTargets t JOIN SlaPolicies p ON p.id = t.slaPolicyId WHERE p.isDefault = 1',
      { type: Sequelize.QueryTypes.SELECT }
    );

    const triggerList = NEW_TRIGGERS.map((v) => `'${v}'`).join(',');
    const ruleIds = `SELECT id FROM WorkflowRules WHERE triggerEvent IN (${triggerList})`;
    await qi.sequelize.query(`DELETE FROM WorkflowRuleLogs WHERE ruleId IN (${ruleIds})`);
    await qi.sequelize.query(`DELETE FROM WorkflowConditions WHERE ruleId IN (${ruleIds})`);
    await qi.sequelize.query(`DELETE FROM WorkflowActions WHERE ruleId IN (${ruleIds})`);
    await qi.sequelize.query(`DELETE FROM WorkflowRules WHERE triggerEvent IN (${triggerList})`);
    await qi.sequelize.query(`DELETE FROM WorkflowActions WHERE actionType IN (${NEW_ACTIONS.map((v) => `'${v}'`).join(',')})`);
    const without = (list, drop, base) => [...new Set([...base, ...list])].filter((v) => !drop.includes(v));
    await changeEnum(qi, 'WorkflowRules', 'triggerEvent', (cur) => without(cur, NEW_TRIGGERS, BASE_TRIGGERS));
    await changeEnum(qi, 'WorkflowActions', 'actionType', (cur) => without(cur, NEW_ACTIONS, BASE_ACTIONS));
    await qi.sequelize.query(`DELETE FROM Notifications WHERE type IN (${NEW_NOTIFICATIONS.map((v) => `'${v}'`).join(',')})`);
    await changeEnum(qi, 'Notifications', 'type', (cur) => without(cur, NEW_NOTIFICATIONS, BASE_NOTIFICATIONS));
    await updateEnabledTypes(qi, Sequelize, (list) => list.filter((v) => !NEW_NOTIFICATIONS.includes(v)));

    await qi.removeColumn('TicketStatuses', 'pausesSla');
    await dropForeignKeys(qi, 'Companies', 'slaPolicyId');
    await qi.removeColumn('Companies', 'slaPolicyId');
    await qi.dropTable('TicketSlas');
    await qi.dropTable('SlaTargets');
    await qi.dropTable('SlaPolicies');

    await qi.createTable('SlaPolicies', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      priority: { type: dt.ENUM(...PRIORITIES), allowNull: false, unique: true },
      firstResponseHours: { type: dt.DECIMAL(6, 2), allowNull: false, defaultValue: 4 },
      resolutionHours: { type: dt.DECIMAL(6, 2), allowNull: false, defaultValue: 24 },
      useBusinessHours: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: dt.DATE, allowNull: false },
      updatedAt: { type: dt.DATE, allowNull: false },
    });
    const byPriority = new Map(targets.map((t) => [t.priority, t]));
    const now = new Date();
    await qi.bulkInsert('SlaPolicies', PRIORITIES.map((p) => {
      const t = byPriority.get(p);
      const [resp, resol, biz] = SEED[p];
      return {
        priority: p,
        firstResponseHours: t && t.responseMinutes ? t.responseMinutes / 60 : resp,
        resolutionHours: t && t.resolutionMinutes ? t.resolutionMinutes / 60 : resol,
        useBusinessHours: t ? !!t.useBusinessHours : biz,
        createdAt: now,
        updatedAt: now,
      };
    }));
  },
};
