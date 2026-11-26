const { DataTypes, Model } = require('sequelize');

// One priced line of an agreement (Phase 3, step 3).
module.exports = (sequelize) => {
  class AgreementLine extends Model {}
  AgreementLine.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      agreementId: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.ENUM('flat', 'per_user', 'per_device', 'license', 'prepaid_hours'), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: false },
      unitPrice: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
      tier: { type: DataTypes.ENUM('full', 'light'), allowNull: true },
      assetCategoryId: { type: DataTypes.INTEGER, allowNull: true },
      catalogProductId: { type: DataTypes.INTEGER, allowNull: true },
      skuId: { type: DataTypes.STRING(64), allowNull: true },
      countSource: { type: DataTypes.ENUM('m365', 'manual'), allowNull: true },
      manualCount: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
      hours: { type: DataTypes.DECIMAL(8, 2), allowNull: true },
      rollover: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      overageRate: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      hoursBalanceMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastBilledQuantity: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
      taxCategoryId: { type: DataTypes.INTEGER, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'AgreementLine', tableName: 'AgreementLines' }
  );
  return AgreementLine;
};
