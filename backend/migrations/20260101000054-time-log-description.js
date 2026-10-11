'use strict';

// time.log's description said "you can edit"; logging your own time needs
// view access (user decision 2026-10-06). The role editor shows it now.
const NEW = 'Log your own time on tickets and projects you can see';
const OLD = 'Log your own time on tickets and projects you can edit';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query("UPDATE Permissions SET description = :d WHERE `key` = 'time.log'", { replacements: { d: NEW } });
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query("UPDATE Permissions SET description = :d WHERE `key` = 'time.log'", { replacements: { d: OLD } });
  },
};
