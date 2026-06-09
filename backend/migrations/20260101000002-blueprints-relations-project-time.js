'use strict';

/**
 * Feature migration:
 *   1. Blueprints (ticket templates) + Ticket.blueprintId / Ticket.customFields
 *   2. Ticket type enum gains 'problem'; TicketRelations join table
 *   3. TimeEntries: ticketId nullable + projectId (project-level time)
 *
 * Idempotent guards (table/column existence) let it re-run safely after a partial
 * apply. All queryInterface calls are bare-awaited; up()/down() return undefined.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Do not destructure `JSON` from Sequelize — it shadows the global JSON.
    // Use Sequelize.JSON for column types instead.
    const { INTEGER, STRING, TEXT, ENUM, DATE } = Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    const hasTable = (name) => tableNames.includes(name);
    const hasColumn = async (table, column) => {
      const schema = await queryInterface.describeTable(table);
      return !!schema[column];
    };

    // 1. Blueprints
    if (!hasTable('Blueprints')) {
      await queryInterface.createTable('Blueprints', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        description: { type: TEXT, allowNull: true },
        category: { type: STRING(255), allowNull: true },
        defaultTitle: { type: STRING(255), allowNull: true },
        defaultDescription: { type: TEXT, allowNull: true },
        defaultPriority: { type: ENUM('low', 'medium', 'high', 'critical'), allowNull: true },
        defaultType: { type: ENUM('incident', 'request', 'problem', 'task', 'change'), allowNull: true },
        defaultDepartmentId: {
          type: INTEGER,
          allowNull: true,
          references: { model: 'Departments', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        customFields: { type: Sequelize.JSON, allowNull: true },
        createdById: {
          type: INTEGER,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    // 2. TicketRelations
    if (!hasTable('TicketRelations')) {
      await queryInterface.createTable('TicketRelations', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: {
          type: INTEGER,
          allowNull: false,
          references: { model: 'Tickets', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        relatedTicketId: {
          type: INTEGER,
          allowNull: false,
          references: { model: 'Tickets', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        relationType: {
          type: ENUM('related', 'caused_by', 'duplicates'),
          allowNull: false,
          defaultValue: 'related',
        },
        createdAt: now,
      });
      await queryInterface.addIndex('TicketRelations', ['ticketId']);
      await queryInterface.addIndex('TicketRelations', ['relatedTicketId']);
    }

    // 3. Ticket: widen type enum, add blueprintId + customFields
    await queryInterface.changeColumn('Tickets', 'type', {
      type: ENUM('incident', 'request', 'problem', 'task', 'change'),
      allowNull: false,
      defaultValue: 'request',
    });
    if (!(await hasColumn('Tickets', 'blueprintId'))) {
      await queryInterface.addColumn('Tickets', 'blueprintId', {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Blueprints', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
    if (!(await hasColumn('Tickets', 'customFields'))) {
      await queryInterface.addColumn('Tickets', 'customFields', { type: Sequelize.JSON, allowNull: true });
    }

    // 4. TimeEntries: ticketId nullable + projectId
    await queryInterface.changeColumn('TimeEntries', 'ticketId', {
      type: INTEGER,
      allowNull: true,
    });
    if (!(await hasColumn('TimeEntries', 'projectId'))) {
      await queryInterface.addColumn('TimeEntries', 'projectId', {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Projects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      });
      await queryInterface.addIndex('TimeEntries', ['projectId']);
    }

    return undefined;
  },

  async down(queryInterface, Sequelize) {
    const { ENUM } = Sequelize;
    const hasColumn = async (table, column) => {
      const schema = await queryInterface.describeTable(table);
      return !!schema[column];
    };

    if (await hasColumn('TimeEntries', 'projectId')) {
      await queryInterface.removeColumn('TimeEntries', 'projectId');
    }
    // Revert ticketId to NOT NULL (only safe if no project-only rows remain).
    await queryInterface.changeColumn('TimeEntries', 'ticketId', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    if (await hasColumn('Tickets', 'customFields')) {
      await queryInterface.removeColumn('Tickets', 'customFields');
    }
    if (await hasColumn('Tickets', 'blueprintId')) {
      await queryInterface.removeColumn('Tickets', 'blueprintId');
    }
    await queryInterface.changeColumn('Tickets', 'type', {
      type: ENUM('incident', 'request', 'task', 'change'),
      allowNull: false,
      defaultValue: 'request',
    });

    await queryInterface.dropTable('TicketRelations');
    await queryInterface.dropTable('Blueprints');

    return undefined;
  },
};
