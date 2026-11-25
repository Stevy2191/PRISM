const { DataTypes, Model } = require('sequelize');

// One change to the shelf (Phase 3, step 2): a receipt, a use, a count.
module.exports = (sequelize) => {
  class StockMovement extends Model {}
  StockMovement.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      productId: { type: DataTypes.INTEGER, allowNull: false },
      quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
      reason: { type: DataTypes.ENUM('receive', 'use', 'adjust'), allowNull: false },
      unitCost: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
      materialId: { type: DataTypes.INTEGER, allowNull: true },
      poLineId: { type: DataTypes.INTEGER, allowNull: true },
      note: { type: DataTypes.STRING(255), allowNull: true },
      ledgerEntryId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'StockMovement', tableName: 'StockMovements', updatedAt: false }
  );
  return StockMovement;
};
