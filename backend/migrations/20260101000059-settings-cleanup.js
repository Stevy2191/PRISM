'use strict';

// The Settings cleanup (user request 2026-10-12, "I don't want to over bloat
// the system"):
//   - company.supportEmail, dateFormat, timeFormat and language did nothing:
//     their rows go;
//   - the organization has one name: the internal company takes the
//     company.name setting's;
//   - workflow department conditions name a department by id (names repeat
//     across client companies): a name that matches exactly one department
//     becomes its id, others stay names (they still match by name);
//   - assignment rules become workflow rules on ticket_created, ahead of the
//     existing ones, and only on tickets with no assignee and no team — so the
//     first match still wins — then their table goes;
//   - Modules & tabs (per-legacy-role nav visibility) goes: tabs follow
//     permissions.
// Idempotent: each step checks what is there.
const DEAD_KEYS = ['company.supportEmail', 'company.dateFormat', 'company.timeFormat', 'company.language'];

async function tableNames(queryInterface) {
  return (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
}

async function convertAssignmentRules(queryInterface, select) {
  const rules = await select('SELECT * FROM AssignmentRules ORDER BY position, id');
  if (!rules.length) return;
  const [{ first }] = await select("SELECT MIN(position) AS first FROM WorkflowRules WHERE triggerEvent = 'ticket_created'");
  // Ahead of every existing ticket_created rule, in their own order.
  const start = (first === null || first === undefined ? 0 : Number(first)) - rules.length;
  const now = new Date();
  for (const [i, r] of rules.entries()) {
    const conditions = [
      ['assignee', 'unassigned'], ['team', 'no_team'],
      ...(r.ticketType ? [['type', r.ticketType]] : []),
      ...(r.departmentId ? [['department', String(r.departmentId)]] : []),
      ...(r.priority ? [['priority', r.priority]] : []),
    ];
    const actions = [
      ...(r.assigneeId ? [['assign_to_user', { userId: r.assigneeId }]] : []),
      ...(r.teamId ? [['assign_to_team', { teamId: r.teamId }]] : []),
    ];
    if (!actions.length) continue; // eslint-disable-line no-continue
    /* eslint-disable no-await-in-loop */
    await queryInterface.bulkInsert('WorkflowRules', [{
      name: r.name,
      description: 'Was an assignment rule.',
      isActive: !!r.isActive,
      position: start + i,
      triggerEvent: 'ticket_created',
      conditionMatch: 'all',
      createdBy: r.createdBy,
      createdAt: now,
      updatedAt: now,
    }]);
    const [{ id }] = await select('SELECT MAX(id) AS id FROM WorkflowRules');
    await queryInterface.bulkInsert('WorkflowConditions', conditions.map(([field, value], position) => ({
      ruleId: id, field, operator: 'equals', value, position, createdAt: now,
    })));
    await queryInterface.bulkInsert('WorkflowActions', actions.map(([actionType, actionValue], position) => ({
      ruleId: id, actionType, actionValue: JSON.stringify(actionValue), position, createdAt: now,
    })));
    /* eslint-enable no-await-in-loop */
  }
}

module.exports = {
  up: async (queryInterface) => {
    const select = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, type: 'SELECT' });
    const tables = await tableNames(queryInterface);

    await queryInterface.bulkDelete('SystemSettings', { key: DEAD_KEYS });

    const [orgName] = await select("SELECT value FROM SystemSettings WHERE `key` = 'company.name'");
    if (orgName && orgName.value && orgName.value.trim()) {
      await queryInterface.sequelize.query('UPDATE Companies SET name = ? WHERE isInternal = 1', { replacements: [orgName.value.trim()] });
    }

    const named = await select(
      "SELECT id, value FROM WorkflowConditions WHERE field IN ('department', 'contact_department') AND value IS NOT NULL AND value NOT REGEXP '^[0-9]+$'"
    );
    for (const c of named) {
      // eslint-disable-next-line no-await-in-loop
      const depts = await select('SELECT id FROM Departments WHERE name = ?', [c.value]);
      if (depts.length === 1) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query('UPDATE WorkflowConditions SET value = ? WHERE id = ?', { replacements: [String(depts[0].id), c.id] });
      }
    }

    if (tables.includes('AssignmentRules')) {
      await convertAssignmentRules(queryInterface, select);
      await queryInterface.dropTable('AssignmentRules');
    }
    if (tables.includes('ModuleVisibility')) await queryInterface.dropTable('ModuleVisibility');
  },

  // The tables come back empty (the converted rules stay workflow rules;
  // module visibility falls back to its defaults). The removed settings and
  // department names aren't restored: nothing read them / ids still match.
  down: async (queryInterface, Sequelize) => {
    const dt = Sequelize;
    const tables = await tableNames(queryInterface);
    if (!tables.includes('AssignmentRules')) {
      await queryInterface.createTable('AssignmentRules', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(200), allowNull: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        ticketType: { type: dt.ENUM('incident', 'request', 'problem', 'change'), allowNull: true },
        departmentId: { type: dt.INTEGER, allowNull: true },
        priority: { type: dt.ENUM('critical', 'high', 'medium', 'low'), allowNull: true },
        assigneeId: { type: dt.INTEGER, allowNull: true },
        teamId: { type: dt.INTEGER, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('ModuleVisibility')) {
      await queryInterface.createTable('ModuleVisibility', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        moduleName: { type: dt.STRING(64), allowNull: false, unique: true },
        visibleToRoles: { type: dt.JSON, allowNull: false },
      });
    }
  },
};
