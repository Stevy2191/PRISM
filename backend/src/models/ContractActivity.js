const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ContractActivity extends Model {}

  ContractActivity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      contractId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(50), allowNull: false },
      detail: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ContractActivity',
      tableName: 'ContractActivity',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ContractActivity;
};
