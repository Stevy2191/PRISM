'use strict';

/**
 * Supports the rebuilt ticket detail page:
 *   1. Users gain timer preference columns (manual vs automatic timer mode).
 *   2. TicketTasks: a lightweight per-ticket checklist.
 *   3. TicketActivities: a per-ticket, human-readable change timeline (distinct
 *      from the system-wide AuditLog, which stays as the cross-entity admin trail).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, TEXT, BOOLEAN, ENUM, DATE } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));

    const usersCols = await queryInterface.describeTable('Users');
    if (!usersCols.timerMode) {
      await queryInterface.addColumn('Users', 'timerMode', {
        type: ENUM('manual', 'automatic'),
        allowNull: false,
        defaultValue: 'manual',
      });
    }
    if (!usersCols.timerMinThreshold) {
      await queryInterface.addColumn('Users', 'timerMinThreshold', {
        type: INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!usersCols.timerPromptBeforeLog) {
      await queryInterface.addColumn('Users', 'timerPromptBeforeLog', {
        type: BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }

    if (!names.includes('TicketTasks')) {
      await queryInterface.createTable('TicketTasks', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: {
          type: INTEGER,
          allowNull: false,
          references: { model: 'Tickets', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        description: { type: STRING(500), allowNull: false },
        completed: { type: BOOLEAN, allowNull: false, defaultValue: false },
        assigneeId: {
          type: INTEGER,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.addIndex('TicketTasks', ['ticketId']);
    }

    if (!names.includes('TicketActivities')) {
      await queryInterface.createTable('TicketActivities', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: {
          type: INTEGER,
          allowNull: false,
          references: { model: 'Tickets', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        userId: {
          type: INTEGER,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        action: { type: STRING(100), allowNull: false },
        fromValue: { type: TEXT, allowNull: true },
        toValue: { type: TEXT, allowNull: true },
        createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.addIndex('TicketActivities', ['ticketId']);
    }

    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TicketActivities');
    await queryInterface.dropTable('TicketTasks');
    await queryInterface.removeColumn('Users', 'timerPromptBeforeLog');
    await queryInterface.removeColumn('Users', 'timerMinThreshold');
    await queryInterface.removeColumn('Users', 'timerMode');
    return undefined;
  },
};
