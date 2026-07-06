'use strict';

// Workflow rules / auto-assignment system: admin-defined trigger + condition
// + action rules that fire automatically on ticket events, plus an
// execution log for debugging. Also adds Tickets.createdBy (never tracked
// before) since the "created_by_role" condition field needs to know who
// filed the ticket.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: dt.NOW };

    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));

    if (!tableNames.includes('WorkflowRules')) {
      await queryInterface.createTable('WorkflowRules', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(255), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        triggerEvent: { type: dt.STRING(50), allowNull: false },
        // Match mode for this rule's conditions: 'all' (AND) or 'any' (OR).
        conditionMatch: { type: dt.ENUM('all', 'any'), allowNull: false, defaultValue: 'all' },
        // Extra trigger config, e.g. { hoursBefore: 24 } for
        // ticket_due_date_approaching. Kept generic so future triggers don't
        // need another migration.
        triggerConfig: { type: dt.JSON, allowNull: true },
        lastTriggeredAt: { type: dt.DATE, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('WorkflowRules', ['isActive', 'triggerEvent']);
    }

    if (!tableNames.includes('WorkflowConditions')) {
      await queryInterface.createTable('WorkflowConditions', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ruleId: { type: dt.INTEGER, allowNull: false },
        field: { type: dt.STRING(100), allowNull: false },
        operator: { type: dt.STRING(30), allowNull: false },
        value: { type: dt.TEXT, allowNull: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
      });
      await queryInterface.addIndex('WorkflowConditions', ['ruleId']);
    }

    if (!tableNames.includes('WorkflowActions')) {
      await queryInterface.createTable('WorkflowActions', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ruleId: { type: dt.INTEGER, allowNull: false },
        actionType: { type: dt.STRING(50), allowNull: false },
        actionValue: { type: dt.JSON, allowNull: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
      });
      await queryInterface.addIndex('WorkflowActions', ['ruleId']);
    }

    if (!tableNames.includes('WorkflowRuleLogs')) {
      await queryInterface.createTable('WorkflowRuleLogs', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ruleId: { type: dt.INTEGER, allowNull: false },
        ticketId: { type: dt.INTEGER, allowNull: false },
        triggeredAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
        conditionsMet: { type: dt.BOOLEAN, allowNull: false },
        actionsExecuted: { type: dt.JSON, allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('WorkflowRuleLogs', ['ruleId']);
      await queryInterface.addIndex('WorkflowRuleLogs', ['ticketId']);
    }

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (!ticketCols.createdBy) {
      await queryInterface.addColumn('Tickets', 'createdBy', { type: dt.INTEGER, allowNull: true });
      await queryInterface.addIndex('Tickets', ['createdBy']);
    }

    // send_notification workflow actions get their own notification type.
    await queryInterface.sequelize.query(
      "ALTER TABLE Notifications MODIFY COLUMN type ENUM('reply','assigned','overdue','comment','due_soon','status_change','watcher_update','workflow') NOT NULL"
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      "ALTER TABLE Notifications MODIFY COLUMN type ENUM('reply','assigned','overdue','comment','due_soon','status_change','watcher_update') NOT NULL"
    );

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (ticketCols.createdBy) {
      await queryInterface.sequelize.query('ALTER TABLE Tickets DROP COLUMN createdBy');
    }

    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('WorkflowRuleLogs')) await queryInterface.dropTable('WorkflowRuleLogs');
    if (tableNames.includes('WorkflowActions')) await queryInterface.dropTable('WorkflowActions');
    if (tableNames.includes('WorkflowConditions')) await queryInterface.dropTable('WorkflowConditions');
    if (tableNames.includes('WorkflowRules')) await queryInterface.dropTable('WorkflowRules');
  },
};
