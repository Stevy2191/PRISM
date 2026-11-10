'use strict';

// "Other / I'm not sure" (sub-project 9, Task 2): not a stored category. The
// ticket keeps the deepest category chosen (or none) and this flag, so staff
// can see what still needs triage. Setting a category clears it.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('Tickets');
    if (!cols.categoryUnsure) {
      await queryInterface.addColumn('Tickets', 'categoryUnsure', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Tickets');
    if (cols.categoryUnsure) await queryInterface.removeColumn('Tickets', 'categoryUnsure');
  },
};
