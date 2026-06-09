'use strict';

/**
 * Server-side per-user running timer, so a started timer resumes on any device.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, ENUM, DATE } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (names.includes('ActiveTimers')) return undefined;

    await queryInterface.createTable('ActiveTimers', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      userId: {
        type: INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      entityType: { type: ENUM('ticket', 'project'), allowNull: false },
      entityId: { type: INTEGER, allowNull: false },
      label: { type: STRING(255), allowNull: true },
      startedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ActiveTimers');
    return undefined;
  },
};
