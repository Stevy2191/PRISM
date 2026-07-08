'use strict';

// Custom report builder: saved builder configurations (data source, fields,
// filters, groupBy, visualization) — distinct from SavedReportViews, which
// only stores a filter combination for one of the fixed built-in reports.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('SavedCustomReports')) return;

    await queryInterface.createTable('SavedCustomReports', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: dt.INTEGER, allowNull: false },
      name: { type: dt.STRING(255), allowNull: false },
      dataSource: { type: dt.STRING(50), allowNull: false },
      fields: { type: dt.JSON, allowNull: false },
      filters: { type: dt.JSON, allowNull: false },
      groupBy: { type: dt.STRING(50), allowNull: true },
      visualization: { type: dt.STRING(20), allowNull: false, defaultValue: 'table' },
      lastRunAt: { type: dt.DATE, allowNull: true },
      createdAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
      updatedAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
    });
    await queryInterface.addIndex('SavedCustomReports', ['userId']);
  },

  down: async (queryInterface) => {
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('SavedCustomReports')) await queryInterface.dropTable('SavedCustomReports');
  },
};
