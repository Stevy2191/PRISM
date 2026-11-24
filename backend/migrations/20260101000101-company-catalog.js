'use strict';

// Each company's software list (9, task 3): the apps a "which app?" category
// step asks about. `kind` is 'software' for now; the same table can later
// hold printers, shared drives and the like. Names are unique per company
// and kind (the controller compares them without case).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('CompanyCatalogItems')) return;
    await queryInterface.createTable('CompanyCatalogItems', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: {
        type: Sequelize.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE',
      },
      kind: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'software' },
      name: { type: Sequelize.STRING(255), allowNull: false },
      publisher: { type: Sequelize.STRING(255), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('CompanyCatalogItems', ['companyId', 'kind', 'name'], { unique: true, name: 'company_catalog_items_name_unique' });
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('CompanyCatalogItems')) await queryInterface.dropTable('CompanyCatalogItems');
  },
};
