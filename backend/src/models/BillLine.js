const { DataTypes, Model } = require('sequelize');

// One line of a bill (Phase 3, step 2): what it was for and, optionally,
// the ticket or project it was for.
module.exports = (sequelize) => {
  class BillLine extends Model {}
  BillLine.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      billId: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.ENUM('contractor', 'materials', 'stock', 'expense'), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      expenseAccount: { type: DataTypes.STRING(20), allowNull: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      purchaseOrderLineId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'BillLine', tableName: 'BillLines', timestamps: false }
  );
  return BillLine;
};
