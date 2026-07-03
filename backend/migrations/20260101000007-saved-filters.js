'use strict';

/**
 * Per-user saved ticket-list filter combinations (search/status/priority/
 * assignee/quick-filters/sort), surfaced from the Tickets page toolbar.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, JSON: JSONType, DATE } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (names.includes('SavedFilters')) return undefined;

    await queryInterface.createTable('SavedFilters', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      userId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: STRING(255), allowNull: false },
      filterJson: { type: JSONType, allowNull: false },
      createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('SavedFilters', ['userId']);
    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SavedFilters');
    return undefined;
  },
};
