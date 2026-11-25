const { DataTypes, Model } = require('sequelize');

// A tax category (Phase 3): what share of a charge is taxable (100, 80, 0 %).
module.exports = (sequelize) => {
  class TaxCategory extends Model {}
  TaxCategory.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      taxablePercent: { type: DataTypes.DECIMAL(7, 4), allowNull: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { sequelize, modelName: 'TaxCategory', tableName: 'TaxCategories' }
  );
  return TaxCategory;
};
