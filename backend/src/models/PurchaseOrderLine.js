const { DataTypes, Model } = require('sequelize');

// One line of a purchase order (Phase 3, step 2), in purchase units (boxes).
module.exports = (sequelize) => {
  class PurchaseOrderLine extends Model {}
  PurchaseOrderLine.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      purchaseOrderId: { type: DataTypes.INTEGER, allowNull: false },
      catalogProductId: { type: DataTypes.INTEGER, allowNull: true },
      description: { type: DataTypes.STRING(500), allowNull: false },
      quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
      unitCost: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      forStock: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      receivedQuantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'PurchaseOrderLine', tableName: 'PurchaseOrderLines', timestamps: false }
  );
  return PurchaseOrderLine;
};
