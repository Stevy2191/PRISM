'use strict';

// Billing on time (Phase 3, step 1).
//   + WorkTypes.onSite: work of this type is an on-site visit (a "call"; the
//     trip charge applies). 'On-site' is set.
//   + TimeEntries.billingStatus: unbilled | covered | billed | non_billable.
//   + TimeEntries.afterHours: null = decide from the customer's SLA support
//     hours; true/false = a technician's override.
//   + TimeEntries.invoiceLineId: the invoice line that billed it (its foreign
//     key comes with invoices, Phase 3 step 3).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const wt = await qi.describeTable('WorkTypes');
    if (!wt.onSite) {
      await qi.addColumn('WorkTypes', 'onSite', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
      await qi.sequelize.query("UPDATE WorkTypes SET onSite = 1 WHERE name = 'On-site'");
    }
    const te = await qi.describeTable('TimeEntries');
    if (!te.billingStatus) {
      await qi.addColumn('TimeEntries', 'billingStatus', {
        type: dt.ENUM('unbilled', 'covered', 'billed', 'non_billable'), allowNull: false, defaultValue: 'unbilled',
      });
      await qi.sequelize.query("UPDATE TimeEntries SET billingStatus = 'non_billable' WHERE billable = 0");
    }
    if (!te.afterHours) await qi.addColumn('TimeEntries', 'afterHours', { type: dt.BOOLEAN, allowNull: true });
    if (!te.invoiceLineId) await qi.addColumn('TimeEntries', 'invoiceLineId', { type: dt.INTEGER, allowNull: true });
  },

  down: async (queryInterface) => {
    const te = await queryInterface.describeTable('TimeEntries');
    for (const col of ['invoiceLineId', 'afterHours', 'billingStatus']) {
      // eslint-disable-next-line no-await-in-loop
      if (te[col]) await queryInterface.removeColumn('TimeEntries', col);
    }
    const wt = await queryInterface.describeTable('WorkTypes');
    if (wt.onSite) await queryInterface.removeColumn('WorkTypes', 'onSite');
  },
};
