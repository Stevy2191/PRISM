const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LicenseActivity extends Model {}

  LicenseActivity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenseId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(50), allowNull: false },
      detail: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LicenseActivity',
      tableName: 'LicenseActivity',
      timestamps: true,
      updatedAt: false,
    }
  );

  return LicenseActivity;
};
