const { DataTypes, Model } = require('sequelize');

// Money received for an invoice, or credit applied to it (Phase 3, step 3).
// amount = appliedAmount (to the invoice) + creditAmount (left over, to the
// customer's credit) + surcharge (the online-payment fee, when set).
module.exports = (sequelize) => {
  class Payment extends Model {}
  const money = () => ({ type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  Payment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      invoiceId: { type: DataTypes.INTEGER, allowNull: true },
      method: { type: DataTypes.ENUM('card', 'us_bank_account', 'check', 'cash', 'transfer', 'credit'), allowNull: false },
      status: { type: DataTypes.ENUM('pending', 'succeeded', 'failed'), allowNull: false, defaultValue: 'succeeded' },
      amount: money(),
      appliedAmount: money(),
      creditAmount: money(),
      surcharge: money(),
      fee: money(),
      refundedAmount: money(),
      receivedOn: { type: DataTypes.DATEONLY, allowNull: true },
      reference: { type: DataTypes.STRING(100), allowNull: true },
      stripeSessionId: { type: DataTypes.STRING(255), allowNull: true },
      stripePaymentIntentId: { type: DataTypes.STRING(255), allowNull: true },
      ledgerEntryId: { type: DataTypes.INTEGER, allowNull: true },
      feeEntryId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Payment', tableName: 'Payments' }
  );
  return Payment;
};
