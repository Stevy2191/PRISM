'use strict';

// Linux packages come in three formats (8c, Task 5): a computer says which
// it installs (deb, rpm or pacman; Windows msi, macOS pkg) at enrollment
// and on each heartbeat, and is only ever offered an update in that format.
// Null: an agent from before 8c (Windows and Mac get their one format).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('Devices');
    if (!cols.packageFormat) {
      await queryInterface.addColumn('Devices', 'packageFormat', { type: Sequelize.STRING(10), allowNull: true });
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Devices');
    if (cols.packageFormat) await queryInterface.removeColumn('Devices', 'packageFormat');
  },
};
