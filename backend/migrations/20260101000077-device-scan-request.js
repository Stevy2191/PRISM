'use strict';

// Scan now (agent): staff ask a computer for a fresh inventory. The next
// heartbeat answers { scan: true }; the inventory that follows clears it.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('Devices');
    if (!cols.scanRequestedAt) {
      await queryInterface.addColumn('Devices', 'scanRequestedAt', { type: Sequelize.DATE, allowNull: true });
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Devices');
    if (cols.scanRequestedAt) await queryInterface.removeColumn('Devices', 'scanRequestedAt');
  },
};
