'use strict';

/**
 * Layouts & Fields (Phase 2): admin-defined CustomFields and per-ticket
 * TicketFieldValues. Idempotent guards allow safe re-runs.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, TEXT, JSON, BOOLEAN, ENUM, DATE } = Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    const hasTable = (n) => names.includes(n);

    if (!hasTable('CustomFields')) {
      await queryInterface.createTable('CustomFields', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        fieldType: {
          type: ENUM('text', 'textarea', 'number', 'select', 'checkbox', 'date', 'url'),
          allowNull: false,
          defaultValue: 'text',
        },
        options: { type: JSON, allowNull: true },
        required: { type: BOOLEAN, allowNull: false, defaultValue: false },
        ticketType: { type: ENUM('incident', 'request', 'problem', 'task', 'change'), allowNull: true },
        departmentId: {
          type: INTEGER, allowNull: true,
          references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        displayOrder: { type: INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
      });
    }

    if (!hasTable('TicketFieldValues')) {
      await queryInterface.createTable('TicketFieldValues', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: {
          type: INTEGER, allowNull: false,
          references: { model: 'Tickets', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        customFieldId: {
          type: INTEGER, allowNull: false,
          references: { model: 'CustomFields', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        value: { type: TEXT, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('TicketFieldValues', ['ticketId', 'customFieldId'], {
        unique: true, name: 'ticket_field_values_unique',
      });
    }

    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TicketFieldValues');
    await queryInterface.dropTable('CustomFields');
    return undefined;
  },
};
