'use strict';

// Install keys you can copy again (8d, Task 1): the key encrypted (only
// staff with Manage devices can reveal it), an optional limit on how many
// computers it enrolls, and when it was last used. Keys made before have
// no copy and keep working; rotating one gives it a copy.

const COLUMNS = {
  secretEnc: (S) => ({ type: S.TEXT, allowNull: true }),
  maxUses: (S) => ({ type: S.INTEGER, allowNull: true }),
  lastUsedAt: (S) => ({ type: S.DATE, allowNull: true }),
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('AgentEnrollmentKeys');
    for (const [name, def] of Object.entries(COLUMNS)) {
      // eslint-disable-next-line no-await-in-loop
      if (!cols[name]) await queryInterface.addColumn('AgentEnrollmentKeys', name, def(Sequelize));
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('AgentEnrollmentKeys');
    for (const name of Object.keys(COLUMNS)) {
      // eslint-disable-next-line no-await-in-loop
      if (cols[name]) await queryInterface.removeColumn('AgentEnrollmentKeys', name);
    }
  },
};
