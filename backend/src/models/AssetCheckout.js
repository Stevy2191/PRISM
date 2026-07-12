const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AssetCheckout extends Model {}

  AssetCheckout.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      checkedOutBy: { type: DataTypes.INTEGER, allowNull: true },
      checkedOutAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      checkedInAt: { type: DataTypes.DATE, allowNull: true },
      checkedInBy: { type: DataTypes.INTEGER, allowNull: true },
      checkoutFormSentAt: { type: DataTypes.DATE, allowNull: true },
      checkoutFormReturnedAt: { type: DataTypes.DATE, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssetCheckout',
      tableName: 'AssetCheckouts',
      timestamps: true,
      updatedAt: false,
    }
  );

  return AssetCheckout;
};
