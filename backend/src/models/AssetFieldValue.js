const { DataTypes, Model } = require('sequelize');

// Stores an asset's value for an admin-defined AssetCategoryField — mirrors
// TicketFieldValue. All values are stored as text; the field definition
// drives interpretation.
module.exports = (sequelize) => {
  class AssetFieldValue extends Model {}

  AssetFieldValue.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      fieldId: { type: DataTypes.INTEGER, allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssetFieldValue',
      tableName: 'AssetFieldValues',
      timestamps: true,
      indexes: [{ unique: true, fields: ['assetId', 'fieldId'] }],
    }
  );

  return AssetFieldValue;
};
