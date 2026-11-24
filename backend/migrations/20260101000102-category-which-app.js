'use strict';

// "Which app?" category steps (9, task 4).
//   + TicketCategories.pickKind: NULL, or 'software' — this category (and
//     everything under it) asks which of the company's apps it's about.
//   + Tickets.catalogItemId: the app chosen (cleared if it's deleted).
//   + Tickets.catalogItemNotListed: answered "Not listed".

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cats = await queryInterface.describeTable('TicketCategories');
    if (!cats.pickKind) await queryInterface.addColumn('TicketCategories', 'pickKind', { type: Sequelize.STRING(20), allowNull: true });
    const tickets = await queryInterface.describeTable('Tickets');
    if (!tickets.catalogItemId) {
      await queryInterface.addColumn('Tickets', 'catalogItemId', {
        type: Sequelize.INTEGER, allowNull: true, references: { model: 'CompanyCatalogItems', key: 'id' }, onDelete: 'SET NULL',
      });
    }
    if (!tickets.catalogItemNotListed) {
      await queryInterface.addColumn('Tickets', 'catalogItemNotListed', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }
  },

  down: async (queryInterface) => {
    const tickets = await queryInterface.describeTable('Tickets');
    if (tickets.catalogItemNotListed) await queryInterface.removeColumn('Tickets', 'catalogItemNotListed');
    if (tickets.catalogItemId) {
      const fks = await queryInterface.getForeignKeyReferencesForTable('Tickets');
      const fk = fks.find((f) => f.columnName === 'catalogItemId');
      if (fk) await queryInterface.removeConstraint('Tickets', fk.constraintName);
      await queryInterface.removeColumn('Tickets', 'catalogItemId');
    }
    const cats = await queryInterface.describeTable('TicketCategories');
    if (cats.pickKind) await queryInterface.removeColumn('TicketCategories', 'pickKind');
  },
};
