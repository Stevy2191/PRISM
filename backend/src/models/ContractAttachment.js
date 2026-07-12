const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ContractAttachment extends Model {}

  ContractAttachment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      contractId: { type: DataTypes.INTEGER, allowNull: false },
      filename: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      mimeType: { type: DataTypes.STRING(100), allowNull: true },
      size: { type: DataTypes.INTEGER, allowNull: true },
      uploadedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ContractAttachment',
      tableName: 'ContractAttachments',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ContractAttachment;
};
