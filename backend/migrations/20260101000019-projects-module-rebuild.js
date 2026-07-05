'use strict';

/**
 * Full Projects module rebuild. Replaces the old single-department /
 * single-owner / Milestones-based schema with: two department roles (owner
 * vs. for), a project lead + team, a real Tasks/Subtasks system (status-
 * driven completion via ProjectStatuses.behaviorType, matching the
 * Ticket/TicketStatus pattern), and dedicated Time Entries / Expenses /
 * Materials / Files / Activity tables scoped to projects (previously time
 * entries were shoehorned into the shared, ticket-oriented TimeEntries
 * table via a nullable projectId).
 *
 * NOTE on removeColumn: queryInterface.removeColumn() throws in this
 * Sequelize/MariaDB-driver combination (see migration 18's comment) — every
 * column/table removal here uses raw DDL instead.
 */
// Drops any foreign-key constraint on tableName.columnName before a
// DROP COLUMN — MariaDB refuses to drop a column whose index is still
// backing an FK constraint, and the constraint name is auto-generated
// (not something this codebase tracks), so it's looked up dynamically.
async function dropForeignKeysOn(queryInterface, tableName, columnName) {
  const { QueryTypes } = require('sequelize');
  const rows = await queryInterface.sequelize.query(
    `
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '${tableName}'
      AND COLUMN_NAME = '${columnName}'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `,
    { type: QueryTypes.SELECT }
  );
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await queryInterface.sequelize.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    // ---- Projects: add new columns, migrate data, drop old columns ----
    await queryInterface.addColumn('Projects', 'ownerDepartmentId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Projects', 'forDepartmentId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Projects', 'assignedToUserId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Projects', 'teamId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Projects', 'closedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('Projects', 'createdBy', { type: Sequelize.INTEGER, allowNull: true });

    await q('UPDATE `Projects` SET `ownerDepartmentId` = `departmentId`, `forDepartmentId` = `departmentId`');
    await q('UPDATE `Projects` SET `assignedToUserId` = `ownerId`');

    const projectCols = await queryInterface.describeTable('Projects');
    if (projectCols.departmentId) {
      await dropForeignKeysOn(queryInterface, 'Projects', 'departmentId');
      await q('ALTER TABLE `Projects` DROP COLUMN `departmentId`');
    }
    if (projectCols.ownerId) {
      await dropForeignKeysOn(queryInterface, 'Projects', 'ownerId');
      await q('ALTER TABLE `Projects` DROP COLUMN `ownerId`');
    }

    // ---- Drop Milestones (superseded by ProjectTasks/ProjectSubtasks) ----
    const tables = await queryInterface.showAllTables();
    if (tables.includes('Milestones')) await q('DROP TABLE `Milestones`');

    // ---- ProjectMembers ----
    await queryInterface.createTable('ProjectMembers', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      role: { type: Sequelize.ENUM('lead', 'member'), allowNull: false, defaultValue: 'member' },
      addedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- ProjectTasks ----
    await queryInterface.createTable('ProjectTasks', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      statusId: { type: Sequelize.INTEGER, allowNull: false },
      priority: { type: Sequelize.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
      assignedToUserId: { type: Sequelize.INTEGER, allowNull: true },
      dueDate: { type: Sequelize.DATEONLY, allowNull: true },
      linkedTicketId: { type: Sequelize.INTEGER, allowNull: true },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- ProjectSubtasks ----
    await queryInterface.createTable('ProjectSubtasks', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      taskId: { type: Sequelize.INTEGER, allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: false },
      statusId: { type: Sequelize.INTEGER, allowNull: false },
      assignedToUserId: { type: Sequelize.INTEGER, allowNull: true },
      dueDate: { type: Sequelize.DATEONLY, allowNull: true },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- ProjectTimeEntries (dedicated — no longer shares TimeEntries) ----
    await queryInterface.createTable('ProjectTimeEntries', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      taskId: { type: Sequelize.INTEGER, allowNull: true },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      loggedForUserId: { type: Sequelize.INTEGER, allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      startTime: { type: Sequelize.DATE, allowNull: true },
      endTime: { type: Sequelize.DATE, allowNull: true },
      durationSeconds: { type: Sequelize.INTEGER, allowNull: true },
      entryDate: { type: Sequelize.DATEONLY, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // Best-effort carry-forward of existing project-linked TimeEntries rows.
    const timeEntryCols = await queryInterface.describeTable('TimeEntries');
    if (timeEntryCols.projectId) {
      await q(`
        INSERT INTO \`ProjectTimeEntries\`
          (\`projectId\`, \`userId\`, \`loggedForUserId\`, \`description\`, \`startTime\`, \`endTime\`, \`durationSeconds\`, \`entryDate\`, \`createdAt\`)
        SELECT \`projectId\`, COALESCE(\`loggedById\`, \`userId\`), \`userId\`, \`note\`, \`startTime\`, \`endTime\`, \`durationSeconds\`, \`entryDate\`, COALESCE(\`loggedAt\`, NOW())
        FROM \`TimeEntries\`
        WHERE \`projectId\` IS NOT NULL
      `);
      await dropForeignKeysOn(queryInterface, 'TimeEntries', 'projectId');
      await q('ALTER TABLE `TimeEntries` DROP COLUMN `projectId`');
    }

    // ---- ProjectExpenses ----
    await queryInterface.createTable('ProjectExpenses', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      taskId: { type: Sequelize.INTEGER, allowNull: true },
      description: { type: Sequelize.STRING(500), allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      category: { type: Sequelize.ENUM('materials', 'labor', 'travel', 'equipment', 'other'), allowNull: false, defaultValue: 'other' },
      entryDate: { type: Sequelize.DATEONLY, allowNull: false },
      loggedBy: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- ProjectMaterials ----
    await queryInterface.createTable('ProjectMaterials', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      taskId: { type: Sequelize.INTEGER, allowNull: true },
      itemName: { type: Sequelize.STRING(255), allowNull: false },
      vendor: { type: Sequelize.STRING(255), allowNull: true },
      modelNumber: { type: Sequelize.STRING(255), allowNull: true },
      // JSON array of serials — "optional, can add multiple" per spec.
      serialNumber: { type: Sequelize.JSON, allowNull: true },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      unitCost: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      totalCost: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      notes: { type: Sequelize.TEXT, allowNull: true },
      addedBy: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- ProjectFiles ----
    await queryInterface.createTable('ProjectFiles', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      taskId: { type: Sequelize.INTEGER, allowNull: true },
      // Display (original) filename; on-disk location is filepath.
      filename: { type: Sequelize.STRING(255), allowNull: false },
      filepath: { type: Sequelize.STRING(500), allowNull: false },
      filesize: { type: Sequelize.INTEGER, allowNull: false },
      uploadedBy: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- ProjectActivity ----
    await queryInterface.createTable('ProjectActivities', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: true },
      action: { type: Sequelize.STRING(100), allowNull: false },
      detail: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // ---- Indexes for the FK-ish columns (no formal FK constraints, matching
    // this codebase's existing convention of soft references + app-level checks) ----
    await queryInterface.addIndex('ProjectMembers', ['projectId']);
    await queryInterface.addIndex('ProjectMembers', ['userId']);
    await queryInterface.addIndex('ProjectTasks', ['projectId']);
    await queryInterface.addIndex('ProjectSubtasks', ['taskId']);
    await queryInterface.addIndex('ProjectTimeEntries', ['projectId']);
    await queryInterface.addIndex('ProjectExpenses', ['projectId']);
    await queryInterface.addIndex('ProjectMaterials', ['projectId']);
    await queryInterface.addIndex('ProjectFiles', ['projectId']);
    await queryInterface.addIndex('ProjectActivities', ['projectId']);

    return undefined;
  },

  async down(queryInterface, Sequelize) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    await q('DROP TABLE IF EXISTS `ProjectActivities`');
    await q('DROP TABLE IF EXISTS `ProjectFiles`');
    await q('DROP TABLE IF EXISTS `ProjectMaterials`');
    await q('DROP TABLE IF EXISTS `ProjectExpenses`');
    await q('DROP TABLE IF EXISTS `ProjectTimeEntries`');
    await q('DROP TABLE IF EXISTS `ProjectSubtasks`');
    await q('DROP TABLE IF EXISTS `ProjectTasks`');
    await q('DROP TABLE IF EXISTS `ProjectMembers`');

    const timeEntryCols = await queryInterface.describeTable('TimeEntries');
    if (!timeEntryCols.projectId) {
      await queryInterface.addColumn('TimeEntries', 'projectId', { type: Sequelize.INTEGER, allowNull: true });
    }

    const projectCols = await queryInterface.describeTable('Projects');
    if (!projectCols.departmentId) {
      await queryInterface.addColumn('Projects', 'departmentId', { type: Sequelize.INTEGER, allowNull: true });
      await q('UPDATE `Projects` SET `departmentId` = `ownerDepartmentId`');
    }
    if (!projectCols.ownerId) {
      await queryInterface.addColumn('Projects', 'ownerId', { type: Sequelize.INTEGER, allowNull: true });
      await q('UPDATE `Projects` SET `ownerId` = `assignedToUserId`');
    }
    if (projectCols.createdBy) await q('ALTER TABLE `Projects` DROP COLUMN `createdBy`');
    if (projectCols.closedAt) await q('ALTER TABLE `Projects` DROP COLUMN `closedAt`');
    if (projectCols.teamId) await q('ALTER TABLE `Projects` DROP COLUMN `teamId`');
    if (projectCols.assignedToUserId) await q('ALTER TABLE `Projects` DROP COLUMN `assignedToUserId`');
    if (projectCols.forDepartmentId) await q('ALTER TABLE `Projects` DROP COLUMN `forDepartmentId`');
    if (projectCols.ownerDepartmentId) await q('ALTER TABLE `Projects` DROP COLUMN `ownerDepartmentId`');

    return undefined;
  },
};
