const { DataTypes, Model } = require('sequelize');

// Something the team paid for directly, with its receipt (Phase 3, step 2).
// Posted when recorded; corrected by voiding (a reversal), never edited.
module.exports = (sequelize) => {
  class Expense extends Model {}
  Expense.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      spentOn: { type: DataTypes.DATEONLY, allowNull: false },
      account: { type: DataTypes.STRING(20), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      paymentMethod: { type: DataTypes.STRING(40), allowNull: false },
      vendorCompanyId: { type: DataTypes.INTEGER, allowNull: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      rebillable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      billingStatus: { type: DataTypes.ENUM('unbilled', 'billed', 'non_billable'), allowNull: false, defaultValue: 'non_billable' },
      invoiceLineId: { type: DataTypes.INTEGER, allowNull: true },
      receiptName: { type: DataTypes.STRING(255), allowNull: true },
      receiptFile: { type: DataTypes.STRING(255), allowNull: true },
      ledgerEntryId: { type: DataTypes.INTEGER, allowNull: true },
      voided: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      voidReason: { type: DataTypes.STRING(255), allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Expense', tableName: 'Expenses' }
  );
  return Expense;
};
