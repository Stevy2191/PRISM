const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LicenseAsset extends Model {}

  LicenseAsset.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenseId: { type: DataTypes.INTEGER, allowNull: false },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      assignedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LicenseAsset',
      tableName: 'LicenseAssets',
      timestamps: false,
    }
  );

  return LicenseAsset;
};
