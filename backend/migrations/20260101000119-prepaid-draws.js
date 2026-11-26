'use strict';

// Prepaid hours (Phase 3, step 3 review): what each invoice line drew from
// a prepaid block, and for which month of work. The balance is worked out
// from these (lines of void invoices don't count), so a deleted draft or a
// voided invoice gives its hours back, and every month credits the block
// whether or not there was work.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const t = await queryInterface.describeTable('InvoiceLines');
    if (!t.prepaidMinutes) await queryInterface.addColumn('InvoiceLines', 'prepaidMinutes', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    if (!t.blockMonth) await queryInterface.addColumn('InvoiceLines', 'blockMonth', { type: Sequelize.STRING(7), allowNull: true });
  },

  down: async (queryInterface) => {
    const t = await queryInterface.describeTable('InvoiceLines');
    if (t.blockMonth) await queryInterface.removeColumn('InvoiceLines', 'blockMonth');
    if (t.prepaidMinutes) await queryInterface.removeColumn('InvoiceLines', 'prepaidMinutes');
  },
};
