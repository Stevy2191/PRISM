'use strict';

// The PRISM agent (8a, task 5): every ticket needs a contact, so a ticket
// raised from the tray by someone who matches no contact goes to the
// company's "Unknown tray user" placeholder (one per company, created on
// first use). Contacts.isPlaceholder marks it: it has no email and no portal
// access, and inventory matching skips it. Rolling back leaves the
// placeholder contacts as ordinary contacts.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('Contacts');
    if (!cols.isPlaceholder) {
      await queryInterface.addColumn('Contacts', 'isPlaceholder', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      });
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Contacts');
    if (cols.isPlaceholder) await queryInterface.removeColumn('Contacts', 'isPlaceholder');
  },
};
