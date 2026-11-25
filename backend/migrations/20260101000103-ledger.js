'use strict';

// The ledger (Phase 3, step 1): double-entry records underneath every money
// record. A fixed chart of accounts (level A books); entries are written only
// by PRISM and never changed: a correction is a reversal.

const ACCOUNTS = [
  ['1000', 'Cash', 'asset'],
  ['1010', 'Stripe clearing', 'asset'],
  ['1100', 'Accounts receivable', 'asset'],
  ['1200', 'Inventory', 'asset'],
  ['2000', 'Accounts payable', 'liability'],
  ['2100', 'Sales tax payable', 'liability'],
  ['2200', 'Customer credits', 'liability'],
  ['3000', "Owner's equity", 'equity'],
  ['4000', 'Managed services income', 'income'],
  ['4100', 'Labor income', 'income'],
  ['4200', 'Product sales', 'income'],
  ['4300', 'Fees income', 'income'],
  ['5000', 'Cost of materials', 'expense'],
  ['5100', 'Contractor costs', 'expense'],
  ['6000', 'Payment processing fees', 'expense'],
  ['6100', 'Office and software', 'expense'],
  ['6200', 'Vehicle and fuel', 'expense'],
  ['6300', 'Tools and equipment', 'expense'],
  ['6900', 'Other expenses', 'expense'],
];

// showAllTables gives names or { tableName } depending on the dialect.
const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  ACCOUNTS,
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const tables = await tableNames(qi);
    if (!tables.includes('LedgerAccounts')) {
      await qi.createTable('LedgerAccounts', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        code: { type: dt.STRING(20), allowNull: false, unique: true },
        name: { type: dt.STRING(100), allowNull: false },
        type: { type: dt.ENUM('asset', 'liability', 'income', 'expense', 'equity'), allowNull: false },
        system: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        active: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('LedgerEntries')) {
      await qi.createTable('LedgerEntries', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        entryDate: { type: dt.DATEONLY, allowNull: false },
        memo: { type: dt.STRING(255), allowNull: true },
        sourceType: { type: dt.STRING(40), allowNull: false },
        sourceId: { type: dt.INTEGER, allowNull: true },
        companyId: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Companies', key: 'id' }, onDelete: 'SET NULL',
        },
        reversesId: {
          type: dt.INTEGER, allowNull: true, references: { model: 'LedgerEntries', key: 'id' }, onDelete: 'RESTRICT',
        },
        createdBy: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('LedgerEntries', ['entryDate'], { name: 'ledger_entries_date' });
      await qi.addIndex('LedgerEntries', ['sourceType', 'sourceId'], { name: 'ledger_entries_source' });
      await qi.addIndex('LedgerEntries', ['reversesId'], { unique: true, name: 'ledger_entries_reverses_once' });
    }
    if (!tables.includes('LedgerLines')) {
      await qi.createTable('LedgerLines', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        entryId: {
          type: dt.INTEGER, allowNull: false, references: { model: 'LedgerEntries', key: 'id' }, onDelete: 'CASCADE',
        },
        accountId: {
          type: dt.INTEGER, allowNull: false, references: { model: 'LedgerAccounts', key: 'id' }, onDelete: 'RESTRICT',
        },
        debit: { type: dt.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        credit: { type: dt.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      });
    }
    const now = new Date();
    for (const [code, name, type] of ACCOUNTS) {
      // eslint-disable-next-line no-await-in-loop
      const [[found]] = await qi.sequelize.query('SELECT id FROM LedgerAccounts WHERE code = :code', { replacements: { code } });
      // eslint-disable-next-line no-await-in-loop
      if (!found) await qi.bulkInsert('LedgerAccounts', [{ code, name, type, system: true, active: true, createdAt: now, updatedAt: now }]);
    }
  },

  down: async (queryInterface) => {
    const tables = await tableNames(queryInterface);
    if (tables.includes('LedgerLines')) await queryInterface.dropTable('LedgerLines');
    if (tables.includes('LedgerEntries')) await queryInterface.dropTable('LedgerEntries');
    if (tables.includes('LedgerAccounts')) await queryInterface.dropTable('LedgerAccounts');
  },
};
