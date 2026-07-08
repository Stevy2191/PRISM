'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const userCols = await queryInterface.describeTable('Users');
    if (!userCols.userType) {
      await queryInterface.addColumn('Users', 'userType', {
        type: dt.ENUM('internal', 'contractor'), allowNull: false, defaultValue: 'internal',
      });
    }
    if (!userCols.hourlyRate) {
      await queryInterface.addColumn('Users', 'hourlyRate', { type: dt.DECIMAL(10, 2), allowNull: true });
    }

    const teCols = await queryInterface.describeTable('TimeEntries');
    if (!teCols.laborCost) {
      await queryInterface.addColumn('TimeEntries', 'laborCost', { type: dt.DECIMAL(10, 2), allowNull: true });
    }

    const pteCols = await queryInterface.describeTable('ProjectTimeEntries');
    if (!pteCols.laborCost) {
      await queryInterface.addColumn('ProjectTimeEntries', 'laborCost', { type: dt.DECIMAL(10, 2), allowNull: true });
    }
  },

  down: async (queryInterface) => {
    const pteCols = await queryInterface.describeTable('ProjectTimeEntries');
    if (pteCols.laborCost) await queryInterface.removeColumn('ProjectTimeEntries', 'laborCost');

    const teCols = await queryInterface.describeTable('TimeEntries');
    if (teCols.laborCost) await queryInterface.removeColumn('TimeEntries', 'laborCost');

    const userCols = await queryInterface.describeTable('Users');
    if (userCols.hourlyRate) await queryInterface.removeColumn('Users', 'hourlyRate');
    if (userCols.userType) await queryInterface.removeColumn('Users', 'userType');
  },
};
