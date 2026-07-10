'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (!ticketCols.dueTime) {
      await queryInterface.addColumn('Tickets', 'dueTime', { type: dt.TIME, allowNull: true });
    }
  },

  down: async (queryInterface) => {
    const ticketCols = await queryInterface.describeTable('Tickets');
    if (ticketCols.dueTime) await queryInterface.removeColumn('Tickets', 'dueTime');
  },
};
