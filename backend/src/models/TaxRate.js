const { DataTypes, Model } = require('sequelize');

// A sales tax rate (Phase 3): one combined rate per location; one is the default.
module.exports = (sequelize) => {
  class TaxRate extends Model {}
  TaxRate.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      ratePercent: { type: DataTypes.DECIMAL(7, 4), allowNull: false },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { sequelize, modelName: 'TaxRate', tableName: 'TaxRates' }
  );
  return TaxRate;
};
