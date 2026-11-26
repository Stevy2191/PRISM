const { DataTypes, Model } = require('sequelize');

// Money given back: part of a payment, or a customer's credit (Phase 3).
module.exports = (sequelize) => {
  class Refund extends Model {}
  Refund.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      paymentId: { type: DataTypes.INTEGER, allowNull: true },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      method: { type: DataTypes.ENUM('stripe', 'check', 'cash', 'transfer'), allowNull: false },
      fromCredit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reason: { type: DataTypes.STRING(255), allowNull: true },
      reference: { type: DataTypes.STRING(100), allowNull: true },
      stripeRefundId: { type: DataTypes.STRING(255), allowNull: true },
      ledgerEntryId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Refund', tableName: 'Refunds' }
  );
  return Refund;
};
