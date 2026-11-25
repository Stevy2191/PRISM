'use strict';

// Phase 3 review: a material's unit cost keeps 4 decimals ($0.0475 a foot of
// a $47.50 box), so its total matches what the books posted.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('ProjectMaterials', 'unitCost', { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 });
    await queryInterface.changeColumn('ProjectMaterials', 'totalCost', { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('ProjectMaterials', 'unitCost', { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
    await queryInterface.changeColumn('ProjectMaterials', 'totalCost', { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
  },
};
