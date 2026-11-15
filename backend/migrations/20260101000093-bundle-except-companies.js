'use strict';

// A checklist bundle offered to every company can be turned off for one of
// them, on that company's page (CS part 4, What applies here).
//   + Playbooks.exceptCompanyIds (null or [companyId]: not offered there)

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('Playbooks');
    if (!cols.exceptCompanyIds) await queryInterface.addColumn('Playbooks', 'exceptCompanyIds', { type: Sequelize.JSON, allowNull: true });
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Playbooks');
    if (cols.exceptCompanyIds) await queryInterface.removeColumn('Playbooks', 'exceptCompanyIds');
  },
};
