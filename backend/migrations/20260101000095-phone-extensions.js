'use strict';

// A person's phone extension (owner, 2026-11-15): up to 4 digits beside the
// phone number, on contacts and on staff.
//   + Contacts.phoneExt, Users.phoneExt

const TABLES = ['Contacts', 'Users'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    for (const table of TABLES) {
      const cols = await queryInterface.describeTable(table); // eslint-disable-line no-await-in-loop
      if (!cols.phoneExt) await queryInterface.addColumn(table, 'phoneExt', { type: Sequelize.STRING(4), allowNull: true }); // eslint-disable-line no-await-in-loop
    }
  },
  down: async (queryInterface) => {
    for (const table of TABLES) {
      const cols = await queryInterface.describeTable(table); // eslint-disable-line no-await-in-loop
      if (cols.phoneExt) await queryInterface.removeColumn(table, 'phoneExt'); // eslint-disable-line no-await-in-loop
    }
  },
};
