'use strict';

/**
 * Supports the rebuilt ticket-creation form:
 *   1. Tickets gain a `tags` column (JSON array of strings).
 *   2. TicketRelations gains a 'parent' relationType — stored as a single row
 *      from the child's perspective (ticketId=child, relatedTicketId=parent);
 *      viewed from the parent side (incoming) it reads as "this is my child".
 *   3. TicketWatchers: users who get notified on ticket create/comment/status
 *      change without being the requester or assignee.
 *   4. Notifications gains a 'watcher_update' type for those notifications.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, JSON: JSONType, ENUM, DATE } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));

    const ticketsCols = await queryInterface.describeTable('Tickets');
    if (!ticketsCols.tags) {
      await queryInterface.addColumn('Tickets', 'tags', { type: JSONType, allowNull: true });
    }

    await queryInterface.changeColumn('TicketRelations', 'relationType', {
      type: ENUM('related', 'caused_by', 'duplicates', 'parent'),
      allowNull: false,
      defaultValue: 'related',
    });

    if (!names.includes('TicketWatchers')) {
      await queryInterface.createTable('TicketWatchers', {
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
          allowNull: false,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.addIndex('TicketWatchers', ['ticketId', 'userId'], { unique: true });
    }

    await queryInterface.changeColumn('Notifications', 'type', {
      type: ENUM('reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update'),
      allowNull: false,
    });

    return undefined;
  },

  async down(queryInterface, Sequelize) {
    const { ENUM } = Sequelize;
    await queryInterface.dropTable('TicketWatchers');
    await queryInterface.removeColumn('Tickets', 'tags');
    await queryInterface.changeColumn('TicketRelations', 'relationType', {
      type: ENUM('related', 'caused_by', 'duplicates'),
      allowNull: false,
      defaultValue: 'related',
    });
    await queryInterface.changeColumn('Notifications', 'type', {
      type: ENUM('reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change'),
      allowNull: false,
    });
    return undefined;
  },
};
