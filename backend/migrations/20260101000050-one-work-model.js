'use strict';

// One work model (sub-project 3, plan 3b). Ticket checklist items, project
// tasks and project subtasks become one Tasks table; ticket time and project
// time become one TimeEntries ledger. The old tables are renamed legacy_* and
// kept, unread, for one release; the next release drops them.
// Ids: project tasks and ticket time keep theirs; project subtasks, ticket
// tasks and project time get new ones (old id + an offset), recorded in
// TaskIdMap / TimeEntryIdMap. Conventions: no DB-level FKs, idempotent
// guards, a down() that refuses rather than lose data.
// See docs/superpowers/specs/2026-10-05-one-work-model-design.md.

const RENAMES = [
  ['TimeEntries', 'legacy_TimeEntries'],
  ['ProjectTimeEntries', 'legacy_ProjectTimeEntries'],
  ['TicketTasks', 'legacy_TicketTasks'],
  ['ProjectTasks', 'legacy_ProjectTasks'],
  ['ProjectSubtasks', 'legacy_ProjectSubtasks'],
];
const NEW_TABLES = ['Tasks', 'TimeEntries', 'TaskStatuses', 'WorkTypes', 'TaskIdMap', 'TimeEntryIdMap'];
const TICKET_TASK_STATUSES = [
  { name: 'To do', color: '#64748b', behaviorType: 'open', position: 0, isDefault: true, isProtected: false },
  { name: 'In progress', color: '#2563eb', behaviorType: 'open', position: 1, isDefault: false, isProtected: false },
  { name: 'Done', color: '#16a34a', behaviorType: 'closed', position: 2, isDefault: false, isProtected: true },
];
const WORK_TYPES = [
  { name: 'Remote support', billableDefault: true, position: 0 },
  { name: 'On-site', billableDefault: true, position: 1 },
  { name: 'Travel', billableDefault: true, position: 2 },
  { name: 'Project work', billableDefault: true, position: 3 },
  { name: 'Admin', billableDefault: false, position: 4 },
];
const PERMISSIONS = [
  { key: 'time.log', category: 'time', label: 'Log time', description: 'Log your own time on tickets and projects you can edit' },
  {
    key: 'time.manage_others', category: 'time', label: "Manage others' time",
    description: 'Log, edit and delete time for other people you can see',
  },
];
const LOG_TIME_SOURCES = ['projects.log_time', 'tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all'];
const MANAGE_OTHERS_ROLES = ['System Administrator', 'Department Manager'];
const TASK_COLUMNS = 'id, ticketId, projectId, parentTaskId, code, title, description, statusId, priority, assigneeId, dueDate, estimateMinutes, position, completedAt, linkedTicketId, createdBy, createdAt, updatedAt';
const TIME_COLUMNS = 'id, ticketId, projectId, taskId, userId, loggedById, entryDate, startTime, endTime, durationSeconds, billable, workTypeId, note, laborCost, createdAt, updatedAt';

// Rows the old tables can't hold; down() refuses while any exist.
const MISFITS = [
  ['ticket tasks with subtasks', 'SELECT COUNT(*) AS n FROM Tasks WHERE ticketId IS NOT NULL AND parentTaskId IS NOT NULL'],
  ['ticket tasks with a description, due date, estimate, priority or linked ticket',
    "SELECT COUNT(*) AS n FROM Tasks WHERE ticketId IS NOT NULL AND (description IS NOT NULL OR dueDate IS NOT NULL OR estimateMinutes IS NOT NULL OR priority <> 'medium' OR linkedTicketId IS NOT NULL)"],
  ['ticket tasks in a status other than the first open or first closed one',
    `SELECT COUNT(*) AS n FROM Tasks t WHERE t.ticketId IS NOT NULL AND t.statusId NOT IN (
       (SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND behaviorType = 'open' ORDER BY position, id LIMIT 1),
       (SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND behaviorType = 'closed' ORDER BY position, id LIMIT 1))`],
  ['project tasks with an estimate', 'SELECT COUNT(*) AS n FROM Tasks WHERE projectId IS NOT NULL AND estimateMinutes IS NOT NULL'],
  ['project subtasks with a description, priority or linked ticket',
    "SELECT COUNT(*) AS n FROM Tasks WHERE projectId IS NOT NULL AND parentTaskId IS NOT NULL AND (description IS NOT NULL OR priority <> 'medium' OR linkedTicketId IS NOT NULL)"],
  ['project tasks in a status the project list doesn\'t have',
    'SELECT COUNT(*) AS n FROM Tasks t WHERE t.projectId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ProjectStatuses p WHERE p.id = t.statusId)'],
  ['time on a ticket task', 'SELECT COUNT(*) AS n FROM TimeEntries WHERE ticketId IS NOT NULL AND taskId IS NOT NULL'],
  ['project time on a subtask',
    'SELECT COUNT(*) AS n FROM TimeEntries e JOIN Tasks t ON t.id = e.taskId WHERE e.projectId IS NOT NULL AND t.parentTaskId IS NOT NULL'],
  ['time that is not billable or has a non-default work type',
    `SELECT COUNT(*) AS n FROM TimeEntries e JOIN WorkTypes w ON w.id = e.workTypeId WHERE e.billable = 0
       OR (e.ticketId IS NOT NULL AND w.name <> 'Remote support') OR (e.projectId IS NOT NULL AND w.name <> 'Project work')`],
  ['expenses, materials or files on a subtask',
    `SELECT (SELECT COUNT(*) FROM ProjectExpenses x JOIN Tasks t ON t.id = x.taskId WHERE t.parentTaskId IS NOT NULL)
       + (SELECT COUNT(*) FROM ProjectMaterials x JOIN Tasks t ON t.id = x.taskId WHERE t.parentTaskId IS NOT NULL)
       + (SELECT COUNT(*) FROM ProjectFiles x JOIN Tasks t ON t.id = x.taskId WHERE t.parentTaskId IS NOT NULL) AS n`],
  ['timers on a task or a project', "SELECT COUNT(*) AS n FROM ActiveTimers WHERE taskId IS NOT NULL OR entityType = 'project'"],
];

async function tableNames(queryInterface) {
  return (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt, QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const run = (sql, replacements, transaction) => db.query(sql, { replacements, transaction });
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const one = async (sql, replacements, transaction) => (await select(sql, replacements, transaction))[0];
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    // 1. Rename the old tables out of the way.
    let tables = await tableNames(queryInterface);
    for (const [from, to] of RENAMES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(from) && !tables.includes(to)) await queryInterface.renameTable(from, to);
    }
    tables = await tableNames(queryInterface);

    // 2. Create the new tables.
    if (!tables.includes('TaskStatuses')) {
      await queryInterface.createTable('TaskStatuses', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        scope: { type: dt.ENUM('ticket', 'project'), allowNull: false },
        name: { type: dt.STRING(100), allowNull: false },
        color: { type: dt.STRING(9), allowNull: false, defaultValue: '#3b82f6' },
        behaviorType: { type: dt.ENUM('open', 'closed', 'archived'), allowNull: false, defaultValue: 'open' },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        isDefault: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        isProtected: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: now,
      });
      await queryInterface.addIndex('TaskStatuses', ['scope', 'position'], { name: 'task_statuses_scope_position' });
    }
    if (!tables.includes('WorkTypes')) {
      await queryInterface.createTable('WorkTypes', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(100), allowNull: false, unique: true },
        billableDefault: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!tables.includes('Tasks')) {
      await queryInterface.createTable('Tasks', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: { type: dt.INTEGER, allowNull: true },
        projectId: { type: dt.INTEGER, allowNull: true },
        parentTaskId: { type: dt.INTEGER, allowNull: true },
        code: { type: dt.STRING(60), allowNull: true, unique: true },
        title: { type: dt.STRING(500), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        statusId: { type: dt.INTEGER, allowNull: false },
        priority: { type: dt.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
        assigneeId: { type: dt.INTEGER, allowNull: true },
        dueDate: { type: dt.DATEONLY, allowNull: true },
        estimateMinutes: { type: dt.INTEGER, allowNull: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        completedAt: { type: dt.DATE, allowNull: true },
        linkedTicketId: { type: dt.INTEGER, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      for (const col of ['ticketId', 'projectId', 'parentTaskId', 'assigneeId', 'linkedTicketId']) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex('Tasks', [col], { name: `tasks_${col}` });
      }
      await run('ALTER TABLE `Tasks` ADD CONSTRAINT `tasks_one_parent` CHECK ((`ticketId` IS NULL) <> (`projectId` IS NULL))');
    }
    if (!tables.includes('TimeEntries')) {
      await queryInterface.createTable('TimeEntries', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: { type: dt.INTEGER, allowNull: true },
        projectId: { type: dt.INTEGER, allowNull: true },
        taskId: { type: dt.INTEGER, allowNull: true },
        userId: { type: dt.INTEGER, allowNull: false },
        loggedById: { type: dt.INTEGER, allowNull: true },
        entryDate: { type: dt.DATEONLY, allowNull: false },
        startTime: { type: dt.DATE, allowNull: true },
        endTime: { type: dt.DATE, allowNull: true },
        durationSeconds: { type: dt.INTEGER, allowNull: false },
        billable: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        workTypeId: { type: dt.INTEGER, allowNull: false },
        note: { type: dt.TEXT, allowNull: true },
        laborCost: { type: dt.DECIMAL(10, 2), allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      for (const cols of [['ticketId'], ['projectId'], ['taskId'], ['userId', 'entryDate'], ['entryDate']]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex('TimeEntries', cols, { name: `ledger_${cols.join('_')}` });
      }
      await run('ALTER TABLE `TimeEntries` ADD CONSTRAINT `ledger_one_parent` CHECK ((`ticketId` IS NULL) <> (`projectId` IS NULL))');
    }
    for (const map of ['TaskIdMap', 'TimeEntryIdMap']) {
      if (!tables.includes(map)) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.createTable(map, {
          oldTable: { type: dt.STRING(40), allowNull: false, primaryKey: true },
          oldId: { type: dt.INTEGER, allowNull: false, primaryKey: true },
          newId: { type: dt.INTEGER, allowNull: false },
        });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex(map, ['newId'], { name: `${map}_new_id` });
      }
    }
    if (!(await queryInterface.describeTable('ActiveTimers')).taskId) {
      await queryInterface.addColumn('ActiveTimers', 'taskId', { type: dt.INTEGER, allowNull: true });
    }

    // 3. Seed the task statuses and work types.
    if (Number((await one('SELECT COUNT(*) AS n FROM TaskStatuses')).n) === 0) {
      // The project scope is today's project statuses, ids and all, so every
      // project task keeps its statusId. The ticket scope is numbered after.
      await run(`INSERT INTO TaskStatuses (id, scope, name, color, behaviorType, position, isDefault, isProtected, createdAt)
        SELECT id, 'project', name, color, behaviorType, position, isDefault, isProtected, createdAt FROM ProjectStatuses`);
      await queryInterface.bulkInsert('TaskStatuses', TICKET_TASK_STATUSES.map((s) => ({ ...s, scope: 'ticket', createdAt: new Date() })));
    }
    if (Number((await one('SELECT COUNT(*) AS n FROM WorkTypes')).n) === 0) {
      await queryInterface.bulkInsert('WorkTypes', WORK_TYPES.map((t) => ({ ...t, isActive: true, createdAt: new Date(), updatedAt: new Date() })));
    }

    // 4. Copy the data, once, in one transaction.
    const started = Number((await one(`SELECT (SELECT COUNT(*) FROM Tasks) + (SELECT COUNT(*) FROM TimeEntries)
      + (SELECT COUNT(*) FROM TaskIdMap) + (SELECT COUNT(*) FROM TimeEntryIdMap) AS n`)).n);
    if (started > 0) return;

    await db.transaction(async (transaction) => {
      const t = transaction;
      const id = async (sql, r) => Number((await one(sql, r, t)).id);
      const max = async (table) => Number((await one(`SELECT COALESCE(MAX(id), 0) AS m FROM \`${table}\``, {}, t)).m);
      const todoId = await id("SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND name = 'To do'");
      const doneId = await id("SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND name = 'Done'");
      const remoteId = await id("SELECT id FROM WorkTypes WHERE name = 'Remote support'");
      const projectWorkId = await id("SELECT id FROM WorkTypes WHERE name = 'Project work'");
      const subOffset = await max('legacy_ProjectTasks');
      const ticketTaskOffset = subOffset + (await max('legacy_ProjectSubtasks'));
      const projectTimeOffset = await max('legacy_TimeEntries');

      // Project tasks keep their ids, codes and statuses.
      await run(`INSERT INTO Tasks (${TASK_COLUMNS})
        SELECT id, NULL, projectId, NULL, taskCode, title, description, statusId, priority, assignedToUserId, dueDate, NULL,
          position, completedAt, linkedTicketId, createdBy, createdAt, updatedAt
        FROM legacy_ProjectTasks`, {}, t);

      // Subtasks become tasks under their task. A subtask whose task is gone
      // was already invisible; it stays only in the legacy table.
      await run(`INSERT INTO TaskIdMap (oldTable, oldId, newId)
        SELECT 'ProjectSubtasks', s.id, s.id + :subOffset FROM legacy_ProjectSubtasks s JOIN legacy_ProjectTasks p ON p.id = s.taskId`,
      { subOffset }, t);
      await run(`INSERT INTO Tasks (${TASK_COLUMNS})
        SELECT s.id + :subOffset, NULL, p.projectId, p.id, s.subtaskCode, s.title, NULL, s.statusId, 'medium', s.assignedToUserId, s.dueDate,
          NULL, s.position, s.completedAt, NULL, NULL, s.createdAt, s.updatedAt
        FROM legacy_ProjectSubtasks s JOIN legacy_ProjectTasks p ON p.id = s.taskId`, { subOffset }, t);

      // Checklist items become ticket tasks: To do or Done, numbered per
      // ticket in creation order. LPAD truncates, so long numbers are written whole.
      await run(`INSERT INTO TaskIdMap (oldTable, oldId, newId)
        SELECT 'TicketTasks', id, id + :ticketTaskOffset FROM legacy_TicketTasks`, { ticketTaskOffset }, t);
      await run(`INSERT INTO Tasks (${TASK_COLUMNS})
        SELECT x.id + :ticketTaskOffset, x.ticketId, NULL, NULL,
          CONCAT('#', IF(x.ticketId < 100000, LPAD(x.ticketId, 5, '0'), x.ticketId), '-T', IF(x.rn < 100, LPAD(x.rn, 2, '0'), x.rn)),
          x.description, NULL, IF(x.completed, :doneId, :todoId), 'medium', x.assigneeId, NULL, NULL, x.rn,
          IF(x.completed, x.updatedAt, NULL), NULL, NULL, x.createdAt, x.updatedAt
        FROM (SELECT tt.*, ROW_NUMBER() OVER (PARTITION BY tt.ticketId ORDER BY tt.createdAt, tt.id) AS rn FROM legacy_TicketTasks tt) x`,
      { ticketTaskOffset, doneId, todoId }, t);

      // Project tasks and subtasks that never got a code get the next free one.
      const uncoded = await select(`SELECT k.id, k.projectId, k.parentTaskId, p.projectCode, parent.code AS parentCode
        FROM Tasks k JOIN Projects p ON p.id = k.projectId LEFT JOIN Tasks parent ON parent.id = k.parentTaskId
        WHERE k.code IS NULL ORDER BY k.parentTaskId IS NOT NULL, k.position, k.id`, {}, t);
      for (const task of uncoded) {
        const prefix = task.parentTaskId ? `${task.parentCode}-S` : `${task.projectCode}-T`;
        // eslint-disable-next-line no-await-in-loop
        const used = await select('SELECT code FROM Tasks WHERE code LIKE :like', { like: `${prefix.replace(/[\\%_]/g, '\\$&')}%` }, t);
        const next = used.reduce((m, r) => Math.max(m, parseInt(r.code.slice(prefix.length), 10) || 0), 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await run('UPDATE Tasks SET code = :code WHERE id = :id', { code: `${prefix}${String(next).padStart(2, '0')}`, id: task.id }, t);
      }

      // Ticket time keeps its ids. Who it's for and who logged it come from
      // each old table's own meaning (Q4).
      await run(`INSERT INTO TimeEntries (${TIME_COLUMNS})
        SELECT id, ticketId, NULL, NULL, userId, loggedById, entryDate, startTime, endTime, COALESCE(durationSeconds, minutes * 60),
          1, :remoteId, note, laborCost, loggedAt, loggedAt
        FROM legacy_TimeEntries`, { remoteId }, t);
      await run(`INSERT INTO TimeEntryIdMap (oldTable, oldId, newId)
        SELECT 'ProjectTimeEntries', id, id + :projectTimeOffset FROM legacy_ProjectTimeEntries`, { projectTimeOffset }, t);
      await run(`INSERT INTO TimeEntries (${TIME_COLUMNS})
        SELECT id + :projectTimeOffset, NULL, projectId, taskId, COALESCE(loggedForUserId, userId), userId, entryDate, startTime, endTime,
          COALESCE(durationSeconds, TIMESTAMPDIFF(SECOND, startTime, endTime), 0), 1, :projectWorkId, description, laborCost, createdAt, createdAt
        FROM legacy_ProjectTimeEntries`, { projectTimeOffset, projectWorkId }, t);

      // Activity rows that name a subtask point at its new id.
      await run(`UPDATE ProjectActivities a JOIN TaskIdMap m
          ON m.oldTable = 'ProjectSubtasks' AND m.oldId = CAST(JSON_VALUE(a.detail, '$.subtaskId') AS INTEGER)
        SET a.detail = JSON_SET(a.detail, '$.subtaskId', m.newId)
        WHERE a.action LIKE 'subtask%' AND JSON_VALUE(a.detail, '$.subtaskId') IS NOT NULL`, {}, t);

      // 5. Permissions (same pattern as the client-companies migration).
      const keys = PERMISSIONS.map((p) => p.key);
      const existing = new Set((await select('SELECT `key` FROM Permissions WHERE `key` IN (:keys)', { keys }, t)).map((r) => r.key));
      const fresh = PERMISSIONS.filter((p) => !existing.has(p.key)).map((p) => ({ ...p, createdAt: new Date() }));
      if (fresh.length) await queryInterface.bulkInsert('Permissions', fresh, { transaction: t });
      const logId = await id("SELECT id FROM Permissions WHERE `key` = 'time.log'");
      const manageId = await id("SELECT id FROM Permissions WHERE `key` = 'time.manage_others'");
      await run(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT DISTINCT rp.roleId, :logId, 1 FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId
        WHERE rp.granted = 1 AND p.\`key\` IN (:sources)
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = rp.roleId AND x.permissionId = :logId)`,
      { logId, sources: LOG_TIME_SOURCES }, t);
      await run(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT r.id, :manageId, 1 FROM Roles r WHERE r.name IN (:names)
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :manageId)`,
      { manageId, names: MANAGE_OTHERS_ROLES }, t);

      // Per-user overrides carry across: a projects.log_time override decides;
      // otherwise a granted ticket-edit override grants time.log.
      const overrides = await select(`SELECT userId, permissionKey, granted, reason, expiresAt, grantedBy FROM UserPermissionOverrides
        WHERE permissionKey IN (:sources)`, { sources: LOG_TIME_SOURCES }, t);
      const already = new Set((await select("SELECT userId FROM UserPermissionOverrides WHERE permissionKey = 'time.log'", {}, t)).map((r) => r.userId));
      const decided = new Map();
      for (const o of overrides) {
        if (already.has(o.userId)) continue; // eslint-disable-line no-continue
        if (o.permissionKey === 'projects.log_time') decided.set(o.userId, { ...o, fromLogTime: true });
        else if (o.granted && !decided.get(o.userId)?.fromLogTime) decided.set(o.userId, { ...o, fromLogTime: false });
      }
      if (decided.size) {
        await queryInterface.bulkInsert('UserPermissionOverrides', [...decided.values()].map((o) => ({
          userId: o.userId, permissionKey: 'time.log', granted: !!o.granted, reason: o.reason, expiresAt: o.expiresAt,
          grantedBy: o.grantedBy, createdAt: new Date(),
        })), { transaction: t });
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const run = (sql, replacements, transaction) => db.query(sql, { replacements, transaction });
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const tables = await tableNames(queryInterface);
    if (!tables.includes('Tasks')) return;

    // Refuse rather than drop anything the old tables can't hold.
    const found = [];
    for (const [label, sql] of MISFITS) {
      // eslint-disable-next-line no-await-in-loop
      const [{ n }] = await select(sql);
      if (Number(n) > 0) found.push(`${n} ${label}`);
    }
    if (found.length) {
      throw new Error(`The old task and time tables can't hold: ${found.join('; ')}. Refusing to roll back and lose them.`);
    }

    // Rebuild the old tables from the new ones, so work done since the
    // upgrade survives. Mapped rows take back their old ids; rows created
    // since get fresh ones (inserted second, so they can't collide).
    await db.transaction(async (t) => {
      await run('SET FOREIGN_KEY_CHECKS = 0', {}, t);
      for (const [, legacy] of RENAMES) await run(`DELETE FROM \`${legacy}\``, {}, t); // eslint-disable-line no-await-in-loop
      await run(`INSERT INTO legacy_ProjectTasks (id, projectId, taskCode, title, description, statusId, priority, assignedToUserId, dueDate,
          linkedTicketId, position, completedAt, createdBy, createdAt, updatedAt)
        SELECT id, projectId, code, title, description, statusId, priority, assigneeId, dueDate, linkedTicketId, position, completedAt,
          createdBy, createdAt, updatedAt
        FROM Tasks WHERE projectId IS NOT NULL AND parentTaskId IS NULL`, {}, t);
      const subtaskCols = 'taskId, subtaskCode, title, statusId, assignedToUserId, dueDate, completedAt, position, createdAt, updatedAt';
      const subtaskVals = 'k.parentTaskId, k.code, k.title, k.statusId, k.assigneeId, k.dueDate, k.completedAt, k.position, k.createdAt, k.updatedAt';
      await run(`INSERT INTO legacy_ProjectSubtasks (id, ${subtaskCols}) SELECT m.oldId, ${subtaskVals}
        FROM Tasks k JOIN TaskIdMap m ON m.oldTable = 'ProjectSubtasks' AND m.newId = k.id
        WHERE k.projectId IS NOT NULL AND k.parentTaskId IS NOT NULL`, {}, t);
      await run(`INSERT INTO legacy_ProjectSubtasks (${subtaskCols}) SELECT ${subtaskVals} FROM Tasks k
        WHERE k.projectId IS NOT NULL AND k.parentTaskId IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM TaskIdMap m WHERE m.oldTable = 'ProjectSubtasks' AND m.newId = k.id)`, {}, t);
      const checklistVals = "k.ticketId, k.title, s.behaviorType = 'closed', k.assigneeId, k.createdAt, k.updatedAt";
      await run(`INSERT INTO legacy_TicketTasks (id, ticketId, description, completed, assigneeId, createdAt, updatedAt)
        SELECT m.oldId, ${checklistVals} FROM Tasks k JOIN TaskStatuses s ON s.id = k.statusId
          JOIN TaskIdMap m ON m.oldTable = 'TicketTasks' AND m.newId = k.id
        WHERE k.ticketId IS NOT NULL`, {}, t);
      await run(`INSERT INTO legacy_TicketTasks (ticketId, description, completed, assigneeId, createdAt, updatedAt)
        SELECT ${checklistVals} FROM Tasks k JOIN TaskStatuses s ON s.id = k.statusId
        WHERE k.ticketId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM TaskIdMap m WHERE m.oldTable = 'TicketTasks' AND m.newId = k.id)`, {}, t);
      await run(`INSERT INTO legacy_TimeEntries (id, ticketId, userId, loggedById, minutes, note, loggedAt, entryDate, startTime, endTime,
          durationSeconds, laborCost)
        SELECT id, ticketId, userId, loggedById, GREATEST(1, ROUND(durationSeconds / 60)), note, createdAt, entryDate, startTime, endTime,
          durationSeconds, laborCost
        FROM TimeEntries WHERE ticketId IS NOT NULL`, {}, t);
      const projectTimeCols = 'projectId, taskId, userId, loggedForUserId, description, startTime, endTime, durationSeconds, entryDate, createdAt, laborCost';
      const projectTimeVals = 'e.projectId, e.taskId, COALESCE(e.loggedById, e.userId), e.userId, e.note, e.startTime, e.endTime, e.durationSeconds, e.entryDate, e.createdAt, e.laborCost';
      await run(`INSERT INTO legacy_ProjectTimeEntries (id, ${projectTimeCols}) SELECT m.oldId, ${projectTimeVals}
        FROM TimeEntries e JOIN TimeEntryIdMap m ON m.oldTable = 'ProjectTimeEntries' AND m.newId = e.id WHERE e.projectId IS NOT NULL`, {}, t);
      await run(`INSERT INTO legacy_ProjectTimeEntries (${projectTimeCols}) SELECT ${projectTimeVals} FROM TimeEntries e
        WHERE e.projectId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM TimeEntryIdMap m WHERE m.oldTable = 'ProjectTimeEntries' AND m.newId = e.id)`, {}, t);
      await run(`UPDATE ProjectActivities a JOIN TaskIdMap m
          ON m.oldTable = 'ProjectSubtasks' AND m.newId = CAST(JSON_VALUE(a.detail, '$.subtaskId') AS INTEGER)
        SET a.detail = JSON_SET(a.detail, '$.subtaskId', m.oldId)
        WHERE a.action LIKE 'subtask%' AND JSON_VALUE(a.detail, '$.subtaskId') IS NOT NULL`, {}, t);
      const perms = await select("SELECT id FROM Permissions WHERE `key` IN ('time.log', 'time.manage_others')", {}, t);
      if (perms.length) {
        await run('DELETE FROM RolePermissions WHERE permissionId IN (:ids)', { ids: perms.map((p) => p.id) }, t);
        await run('DELETE FROM Permissions WHERE id IN (:ids)', { ids: perms.map((p) => p.id) }, t);
      }
      await run("DELETE FROM UserPermissionOverrides WHERE permissionKey IN ('time.log', 'time.manage_others')", {}, t);
      await run('SET FOREIGN_KEY_CHECKS = 1', {}, t);
    });

    if ((await queryInterface.describeTable('ActiveTimers')).taskId) await queryInterface.removeColumn('ActiveTimers', 'taskId');
    for (const table of NEW_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(table)) await queryInterface.dropTable(table);
    }
    for (const [from, to] of RENAMES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(to)) await queryInterface.renameTable(to, from);
    }
  },
};
