'use strict';

// Invoices (Phase 3, step 3): invoices and credit notes, their lines, and
// the link from what they bill (time, materials, expenses) to the line that
// billed it. Drafts have no number: one is given when the invoice is sent,
// so the sequence has no gaps. A run invoice carries its period (one per
// company per month); the pay link's token is stored only as its sha256.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const LINKED = ['TimeEntries', 'ProjectMaterials', 'Expenses'];
const fkName = (table) => `${table.toLowerCase()}_invoice_line_fk`;

async function constraintNames(qi, table) {
  const [rows] = await qi.sequelize.query(
    'SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
    { replacements: { table } },
  );
  return rows.map((r) => r.name);
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const names = await tableNames(qi);
    const fk = (model, onDelete = 'SET NULL') => ({ type: dt.INTEGER, allowNull: true, references: { model, key: 'id' }, onDelete });
    const money = () => ({ type: dt.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
    if (!names.includes('Invoices')) {
      await qi.createTable('Invoices', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        number: { type: dt.STRING(30), allowNull: true, unique: true },
        kind: { type: dt.ENUM('invoice', 'credit_note'), allowNull: false, defaultValue: 'invoice' },
        companyId: { type: dt.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'RESTRICT' },
        agreementId: fk('Agreements'),
        periodKey: { type: dt.STRING(20), allowNull: true },
        ticketId: fk('Tickets'),
        status: { type: dt.ENUM('draft', 'sent', 'partly_paid', 'paid', 'void'), allowNull: false, defaultValue: 'draft' },
        issuedOn: { type: dt.DATEONLY, allowNull: true },
        dueOn: { type: dt.DATEONLY, allowNull: true },
        subtotal: money(),
        taxTotal: money(),
        total: money(),
        amountPaid: money(),
        creditApplied: money(),
        chargeTax: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        billToContactId: fk('Contacts'),
        notes: { type: dt.TEXT, allowNull: true },
        ledgerEntryId: { type: dt.INTEGER, allowNull: true },
        payTokenHash: { type: dt.CHAR(64), allowNull: true, unique: true },
        payTokenExpiresAt: { type: dt.DATE, allowNull: true },
        remindersSent: { type: dt.JSON, allowNull: true },
        lateFeeInvoiceId: fk('Invoices'),
        creditForInvoiceId: fk('Invoices'),
        voidReason: { type: dt.STRING(255), allowNull: true },
        sentAt: { type: dt.DATE, allowNull: true },
        createdBy: fk('Users'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('Invoices', ['companyId', 'periodKey'], { unique: true, name: 'invoices_company_period' });
      await qi.addIndex('Invoices', ['status', 'dueOn'], { name: 'invoices_status_due' });
    }
    if (!names.includes('InvoiceLines')) {
      await qi.createTable('InvoiceLines', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        invoiceId: { type: dt.INTEGER, allowNull: false, references: { model: 'Invoices', key: 'id' }, onDelete: 'CASCADE' },
        kind: {
          type: dt.ENUM('agreement', 'license', 'prepaid_hours', 'labor', 'after_hours', 'trip', 'overage', 'material', 'expense', 'fee', 'late_fee', 'covered'),
          allowNull: false,
        },
        description: { type: dt.STRING(500), allowNull: false },
        quantity: { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
        unitPrice: { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
        amount: money(),
        taxCategoryId: fk('TaxCategories'),
        tax: money(),
        ticketId: fk('Tickets'),
        projectId: fk('Projects'),
        agreementLineId: fk('AgreementLines'),
        serviceFrom: { type: dt.DATEONLY, allowNull: true },
        serviceTo: { type: dt.DATEONLY, allowNull: true },
        sortOrder: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    for (const table of LINKED) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await constraintNames(qi, table)).includes(fkName(table))) {
        // Any stray link from before invoices existed points nowhere.
        await qi.sequelize.query(`UPDATE \`${table}\` SET invoiceLineId = NULL WHERE invoiceLineId IS NOT NULL AND invoiceLineId NOT IN (SELECT id FROM InvoiceLines)`); // eslint-disable-line no-await-in-loop
        // eslint-disable-next-line no-await-in-loop
        await qi.addConstraint(table, {
          fields: ['invoiceLineId'], type: 'foreign key', name: fkName(table), references: { table: 'InvoiceLines', field: 'id' }, onDelete: 'SET NULL',
        });
      }
    }
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    for (const table of LINKED) {
      // eslint-disable-next-line no-await-in-loop
      if ((await constraintNames(qi, table)).includes(fkName(table))) await qi.removeConstraint(table, fkName(table));
    }
    const names = await tableNames(qi);
    if (names.includes('InvoiceLines')) await qi.dropTable('InvoiceLines');
    if (names.includes('Invoices')) await qi.dropTable('Invoices');
  },
};
