const { DataTypes, Model } = require('sequelize');

// One line of an invoice or credit note (Phase 3, step 3).
const KINDS = ['agreement', 'license', 'prepaid_hours', 'labor', 'after_hours', 'trip', 'overage', 'material', 'expense', 'fee', 'late_fee', 'covered'];

module.exports = (sequelize) => {
  class InvoiceLine extends Model {}
  InvoiceLine.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      invoiceId: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.ENUM(...KINDS), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: false },
      quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
      unitPrice: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      taxCategoryId: { type: DataTypes.INTEGER, allowNull: true },
      tax: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      agreementLineId: { type: DataTypes.INTEGER, allowNull: true },
      serviceFrom: { type: DataTypes.DATEONLY, allowNull: true },
      serviceTo: { type: DataTypes.DATEONLY, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'InvoiceLine', tableName: 'InvoiceLines' }
  );
  InvoiceLine.KINDS = KINDS;
  return InvoiceLine;
};
