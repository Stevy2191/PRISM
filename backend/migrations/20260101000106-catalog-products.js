'use strict';

// Products and services (Phase 3, step 1): what the business sells or buys.
// A stocked product bought in one unit (a box of 1,000 ft) and used in another
// (ft) says how many usage units a purchase unit holds.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dt = Sequelize;
    if ((await tableNames(queryInterface)).includes('CatalogProducts')) return;
    await queryInterface.createTable('CatalogProducts', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: dt.STRING(255), allowNull: false, unique: true },
      sku: { type: dt.STRING(100), allowNull: true, unique: true },
      kind: { type: dt.ENUM('labor', 'service', 'product', 'license', 'fee'), allowNull: false },
      unit: { type: dt.STRING(20), allowNull: false, defaultValue: 'each' },
      cost: { type: dt.DECIMAL(12, 4), allowNull: true },
      price: { type: dt.DECIMAL(12, 4), allowNull: true },
      markupPercent: { type: dt.DECIMAL(7, 4), allowNull: true },
      taxCategoryId: {
        type: dt.INTEGER, allowNull: true, references: { model: 'TaxCategories', key: 'id' }, onDelete: 'SET NULL',
      },
      purchaseUnit: { type: dt.STRING(20), allowNull: true },
      usagePerPurchase: { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
      stocked: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
      serialized: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: dt.TEXT, allowNull: true },
      createdAt: { type: dt.DATE, allowNull: false },
      updatedAt: { type: dt.DATE, allowNull: false },
    });
  },
  down: async (queryInterface) => {
    if ((await tableNames(queryInterface)).includes('CatalogProducts')) await queryInterface.dropTable('CatalogProducts');
  },
};
