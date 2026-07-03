'use strict';

/**
 * Per-user notifications, surfaced on the dashboard's Notifications panel.
 * Event-driven types (assigned/reply/comment/status_change) are inserted by
 * the services in src/services/notifications.js when the triggering action
 * happens; time-based types (overdue/due_soon) are derived lazily on read
 * since this app has no job scheduler.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, TEXT, ENUM, BOOLEAN, DATE } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (names.includes('Notifications')) return undefined;

    await queryInterface.createTable('Notifications', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      userId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: ENUM('reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change'),
        allowNull: false,
      },
      message: { type: TEXT, allowNull: false },
      ticketId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Tickets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      isRead: { type: BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('Notifications', ['userId', 'isRead']);
    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Notifications');
    return undefined;
  },
};
