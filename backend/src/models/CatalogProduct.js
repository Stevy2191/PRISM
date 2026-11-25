const { DataTypes, Model } = require('sequelize');

// A product or service the business sells or buys (Phase 3).
module.exports = (sequelize) => {
  class CatalogProduct extends Model {}
  CatalogProduct.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      sku: { type: DataTypes.STRING(100), allowNull: true, unique: true },
      kind: { type: DataTypes.ENUM('labor', 'service', 'product', 'license', 'fee'), allowNull: false },
      unit: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'each' },
      cost: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
      price: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
      markupPercent: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
      taxCategoryId: { type: DataTypes.INTEGER, allowNull: true },
      purchaseUnit: { type: DataTypes.STRING(20), allowNull: true },
      usagePerPurchase: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
      stocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      serialized: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    { sequelize, modelName: 'CatalogProduct', tableName: 'CatalogProducts' }
  );
  return CatalogProduct;
};
