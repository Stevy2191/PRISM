'use strict';

// Expenses (Phase 3, step 2): what the team pays for directly (fuel, a tool,
// toner from the store), with the receipt. Posted when recorded: Dr the
// expense account, Cr Cash. Optionally for a customer's job and billed on.
// The project budget's own expenses (ProjectExpenses) are untouched.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    if ((await tableNames(qi)).includes('Expenses')) return;
    const fk = (model) => ({ type: dt.INTEGER, allowNull: true, references: { model, key: 'id' }, onDelete: 'SET NULL' });
    await qi.createTable('Expenses', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      spentOn: { type: dt.DATEONLY, allowNull: false },
      account: { type: dt.STRING(20), allowNull: false },
      description: { type: dt.STRING(500), allowNull: false },
      amount: { type: dt.DECIMAL(12, 2), allowNull: false },
      paymentMethod: { type: dt.STRING(40), allowNull: false },
      vendorCompanyId: fk('Companies'),
      ticketId: fk('Tickets'),
      projectId: fk('Projects'),
      rebillable: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
      billingStatus: { type: dt.ENUM('unbilled', 'billed', 'non_billable'), allowNull: false, defaultValue: 'non_billable' },
      invoiceLineId: { type: dt.INTEGER, allowNull: true },
      receiptName: { type: dt.STRING(255), allowNull: true },
      receiptFile: { type: dt.STRING(255), allowNull: true },
      ledgerEntryId: { type: dt.INTEGER, allowNull: true },
      voided: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
      voidReason: { type: dt.STRING(255), allowNull: true },
      createdBy: fk('Users'),
      createdAt: { type: dt.DATE, allowNull: false },
      updatedAt: { type: dt.DATE, allowNull: false },
    });
    await qi.addIndex('Expenses', ['spentOn'], { name: 'expenses_spent_on' });
    await qi.addIndex('Expenses', ['ticketId'], { name: 'expenses_ticket' });
    await qi.addIndex('Expenses', ['projectId'], { name: 'expenses_project' });
  },

  down: async (queryInterface) => {
    if ((await tableNames(queryInterface)).includes('Expenses')) await queryInterface.dropTable('Expenses');
  },
};
