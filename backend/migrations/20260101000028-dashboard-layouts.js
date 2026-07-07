'use strict';

// Per-user saved dashboard panel layout (order, full/half sizing, hidden
// panels) for the customizable drag-and-drop dashboard. One row per user —
// no default row is inserted; absence of a row means "use the built-in
// default layout" (decided client-side).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('DashboardLayouts')) return;

    await queryInterface.createTable('DashboardLayouts', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: dt.INTEGER, allowNull: false, unique: true },
      layout: { type: dt.JSON, allowNull: false },
      createdAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
      updatedAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
    });
  },

  down: async (queryInterface) => {
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('DashboardLayouts')) await queryInterface.dropTable('DashboardLayouts');
  },
};
