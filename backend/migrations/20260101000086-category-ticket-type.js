'use strict';

// Incidents and requests have their own categories (sub-project 9, owner
// 2026-11-10). A top-level category says which type it's for: incident,
// request, or null for both; its sub-categories go with it. Existing
// categories are for both until someone sets them.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('TicketCategories');
    if (!cols.ticketType) {
      await queryInterface.addColumn('TicketCategories', 'ticketType', { type: Sequelize.STRING(20), allowNull: true });
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('TicketCategories');
    if (cols.ticketType) await queryInterface.removeColumn('TicketCategories', 'ticketType');
  },
};
