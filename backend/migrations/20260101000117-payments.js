'use strict';

// Payments (Phase 3, step 3): money received for invoices — through Stripe
// Checkout (card or US bank account) or by hand (check, cash, transfer) —
// and customer credit applied to an invoice; and refunds, of a payment or
// of a customer's credit. Stripe ids are unique, so a webhook delivered
// twice records once.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const names = await tableNames(qi);
    const fk = (model, onDelete = 'SET NULL') => ({ type: dt.INTEGER, allowNull: true, references: { model, key: 'id' }, onDelete });
    const money = () => ({ type: dt.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
    if (!names.includes('Payments')) {
      await qi.createTable('Payments', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: { type: dt.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'RESTRICT' },
        invoiceId: fk('Invoices'),
        method: { type: dt.ENUM('card', 'us_bank_account', 'check', 'cash', 'transfer', 'credit'), allowNull: false },
        status: { type: dt.ENUM('pending', 'succeeded', 'failed'), allowNull: false, defaultValue: 'succeeded' },
        amount: money(),
        appliedAmount: money(),
        creditAmount: money(),
        surcharge: money(),
        fee: money(),
        refundedAmount: money(),
        receivedOn: { type: dt.DATEONLY, allowNull: true },
        reference: { type: dt.STRING(100), allowNull: true },
        stripeSessionId: { type: dt.STRING(255), allowNull: true, unique: true },
        stripePaymentIntentId: { type: dt.STRING(255), allowNull: true, unique: true },
        ledgerEntryId: { type: dt.INTEGER, allowNull: true },
        feeEntryId: { type: dt.INTEGER, allowNull: true },
        createdBy: fk('Users'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('Payments', ['companyId', 'receivedOn'], { name: 'payments_company_received' });
      await qi.addIndex('Payments', ['invoiceId'], { name: 'payments_invoice' });
    }
    if (!names.includes('Refunds')) {
      await qi.createTable('Refunds', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: { type: dt.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'RESTRICT' },
        paymentId: fk('Payments'),
        amount: money(),
        method: { type: dt.ENUM('stripe', 'check', 'cash', 'transfer'), allowNull: false },
        fromCredit: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        reason: { type: dt.STRING(255), allowNull: true },
        reference: { type: dt.STRING(100), allowNull: true },
        stripeRefundId: { type: dt.STRING(255), allowNull: true, unique: true },
        ledgerEntryId: { type: dt.INTEGER, allowNull: true },
        createdBy: fk('Users'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
  },

  down: async (queryInterface) => {
    const names = await tableNames(queryInterface);
    if (names.includes('Refunds')) await queryInterface.dropTable('Refunds');
    if (names.includes('Payments')) await queryInterface.dropTable('Payments');
  },
};
