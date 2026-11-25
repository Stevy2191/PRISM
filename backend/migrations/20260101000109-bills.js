'use strict';

// Bills (Phase 3, step 2): what contractors and suppliers charge, linked to
// the tickets and projects the work was for.
//   + Companies.is1099: the vendor gets a 1099 (totals only; no tax IDs).
//   + Bills, BillLines.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const companies = await qi.describeTable('Companies');
    if (!companies.is1099) await qi.addColumn('Companies', 'is1099', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    const tables = await tableNames(qi);
    const fk = (model, onDelete = 'SET NULL', allowNull = true) => ({
      type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onDelete,
    });
    if (!tables.includes('Bills')) {
      await qi.createTable('Bills', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        vendorCompanyId: fk('Companies', 'RESTRICT', false),
        billNumber: { type: dt.STRING(100), allowNull: false },
        billDate: { type: dt.DATEONLY, allowNull: false },
        dueDate: { type: dt.DATEONLY, allowNull: true },
        status: { type: dt.ENUM('received', 'entered', 'paid', 'void'), allowNull: false, defaultValue: 'received' },
        externalRef: { type: dt.STRING(100), allowNull: true },
        total: { type: dt.DECIMAL(12, 2), allowNull: false },
        paidOn: { type: dt.DATEONLY, allowNull: true },
        paidMethod: { type: dt.STRING(40), allowNull: true },
        paidRef: { type: dt.STRING(100), allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        fileName: { type: dt.STRING(255), allowNull: true },
        filePath: { type: dt.STRING(255), allowNull: true },
        ledgerEntryId: { type: dt.INTEGER, allowNull: true },
        paymentEntryId: { type: dt.INTEGER, allowNull: true },
        voidReason: { type: dt.STRING(255), allowNull: true },
        createdBy: fk('Users'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('Bills', ['vendorCompanyId', 'billNumber'], { unique: true, name: 'bills_vendor_number' });
      await qi.addIndex('Bills', ['status'], { name: 'bills_status' });
    }
    if (!tables.includes('BillLines')) {
      await qi.createTable('BillLines', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        billId: fk('Bills', 'CASCADE', false),
        kind: { type: dt.ENUM('contractor', 'materials', 'stock', 'expense'), allowNull: false },
        description: { type: dt.STRING(500), allowNull: false },
        amount: { type: dt.DECIMAL(12, 2), allowNull: false },
        expenseAccount: { type: dt.STRING(20), allowNull: true },
        ticketId: fk('Tickets'),
        projectId: fk('Projects'),
        purchaseOrderLineId: { type: dt.INTEGER, allowNull: true },
      });
      await qi.addIndex('BillLines', ['ticketId'], { name: 'bill_lines_ticket' });
      await qi.addIndex('BillLines', ['projectId'], { name: 'bill_lines_project' });
    }
  },

  down: async (queryInterface) => {
    const tables = await tableNames(queryInterface);
    if (tables.includes('BillLines')) await queryInterface.dropTable('BillLines');
    if (tables.includes('Bills')) await queryInterface.dropTable('Bills');
    const companies = await queryInterface.describeTable('Companies');
    if (companies.is1099) await queryInterface.removeColumn('Companies', 'is1099');
  },
};
