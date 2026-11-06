const { DataTypes, Model } = require('sequelize');

// One installed program on an agent-managed Asset (8a). The agent's
// inventory replaces an Asset's whole list each time.
module.exports = (sequelize) => {
  class AssetSoftware extends Model {}

  AssetSoftware.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      version: { type: DataTypes.STRING(100), allowNull: true },
      publisher: { type: DataTypes.STRING(255), allowNull: true },
      installDate: { type: DataTypes.DATEONLY, allowNull: true },
    },
    { sequelize, modelName: 'AssetSoftware', tableName: 'AssetSoftware', timestamps: false }
  );

  return AssetSoftware;
};
