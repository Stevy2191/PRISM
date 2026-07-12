const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ContractAsset extends Model {}

  ContractAsset.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      contractId: { type: DataTypes.INTEGER, allowNull: false },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      linkedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      linkedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ContractAsset',
      tableName: 'ContractAssets',
      timestamps: false,
    }
  );

  return ContractAsset;
};
