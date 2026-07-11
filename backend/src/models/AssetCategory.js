const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AssetCategory extends Model {}

  AssetCategory.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      icon: { type: DataTypes.STRING(20), allowNull: true },
      color: { type: DataTypes.STRING(20), allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssetCategory',
      tableName: 'AssetCategories',
      timestamps: true,
      updatedAt: false,
    }
  );

  return AssetCategory;
};
