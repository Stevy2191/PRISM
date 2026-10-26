'use strict';

// Project templates (sub-project 6): a named structure of phases, tasks,
// subtasks, milestones and dependencies, with task dates kept as day offsets
// from the project start. Holds no company, assignees, time, files or costs.
// Also Projects.templateId (which template a project was made from) and the
// permission projects.manage_templates.

const PERMISSION = {
  key: 'projects.manage_templates', category: 'projects', label: 'Manage project templates', description: 'Create, edit and delete project templates',
};

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: dt.QueryTypes.SELECT, replacements });
    const fk = (model, onDelete, allowNull = true) => ({ type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onDelete });
    const now = new Date();

    if (!(await tableNames(qi)).includes('ProjectTemplates')) {
      await qi.createTable('ProjectTemplates', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(150), allowNull: false, unique: true },
        description: { type: dt.TEXT, allowNull: true },
        hourBudgetMinutes: { type: dt.INTEGER, allowNull: true },
        tags: { type: dt.JSON, allowNull: true },
        sourceProjectId: fk('Projects', 'SET NULL'),
        createdBy: fk('Users', 'SET NULL'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }

    if (!(await tableNames(qi)).includes('ProjectTemplatePhases')) {
      await qi.createTable('ProjectTemplatePhases', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        templateId: fk('ProjectTemplates', 'CASCADE', false),
        name: { type: dt.STRING(100), allowNull: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        hourBudgetMinutes: { type: dt.INTEGER, allowNull: true },
      });
    }

    if (!(await tableNames(qi)).includes('ProjectTemplateTasks')) {
      await qi.createTable('ProjectTemplateTasks', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        templateId: fk('ProjectTemplates', 'CASCADE', false),
        templatePhaseId: fk('ProjectTemplatePhases', 'SET NULL'),
        parentId: fk('ProjectTemplateTasks', 'CASCADE'),
        title: { type: dt.STRING(500), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        // Day 1 is the project's first day; a milestone has lengthDays 0.
        startDay: { type: dt.INTEGER, allowNull: false, defaultValue: 1 },
        lengthDays: { type: dt.INTEGER, allowNull: false, defaultValue: 1 },
        estimateMinutes: { type: dt.INTEGER, allowNull: true },
        priority: { type: dt.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
        isMilestone: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
      });
      await qi.addIndex('ProjectTemplateTasks', ['templateId', 'position'], { name: 'project_template_tasks_template_position' });
    }

    if (!(await tableNames(qi)).includes('ProjectTemplateDependencies')) {
      await qi.createTable('ProjectTemplateDependencies', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        predecessorId: fk('ProjectTemplateTasks', 'CASCADE', false),
        successorId: fk('ProjectTemplateTasks', 'CASCADE', false),
      });
      await qi.addIndex('ProjectTemplateDependencies', ['predecessorId', 'successorId'], { unique: true, name: 'project_template_dependencies_pair' });
      await qi.addIndex('ProjectTemplateDependencies', ['successorId'], { name: 'project_template_dependencies_successor' });
    }

    if (!(await qi.describeTable('Projects')).templateId) {
      await qi.addColumn('Projects', 'templateId', fk('ProjectTemplates', 'SET NULL'));
    }

    const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (!existing) await qi.bulkInsert('Permissions', [{ ...PERMISSION, createdAt: now }]);
    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    await qi.sequelize.query(
      `INSERT INTO RolePermissions (roleId, permissionId, granted)
       SELECT r.id, :pid, 1 FROM Roles r WHERE r.name = 'System Administrator'
         AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
      { replacements: { pid: perm.id } }
    );
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (perm) {
      await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: perm.id } });
      await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: perm.id } });
    }
    await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: PERMISSION.key } });

    if ((await qi.describeTable('Projects')).templateId) await qi.removeColumn('Projects', 'templateId');
    // Children first: each table points at the one before it in this list.
    for (const table of ['ProjectTemplateDependencies', 'ProjectTemplateTasks', 'ProjectTemplatePhases', 'ProjectTemplates']) {
      if ((await tableNames(qi)).includes(table)) await qi.dropTable(table); // eslint-disable-line no-await-in-loop
    }
  },
};
