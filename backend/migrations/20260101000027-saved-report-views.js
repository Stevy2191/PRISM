'use strict';

// Optional enhancement: lets a user save a report's current filter
// combination (date range, department, assignee) under a name, scoped per
// report type. Mirrors SavedFilters (tickets) exactly, plus a `reportType`
// column since views are per-report rather than global.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('SavedReportViews')) return;

    await queryInterface.createTable('SavedReportViews', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: dt.INTEGER, allowNull: false },
      reportType: { type: dt.STRING(50), allowNull: false },
      name: { type: dt.STRING(255), allowNull: false },
      filters: { type: dt.JSON, allowNull: false },
      createdAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
    });
    await queryInterface.addIndex('SavedReportViews', ['userId', 'reportType']);
  },

  down: async (queryInterface) => {
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('SavedReportViews')) await queryInterface.dropTable('SavedReportViews');
  },
};
