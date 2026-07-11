const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AssetActivity extends Model {}

  AssetActivity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(50), allowNull: false },
      detail: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssetActivity',
      tableName: 'AssetActivity',
      timestamps: true,
      updatedAt: false,
    }
  );

  return AssetActivity;
};
