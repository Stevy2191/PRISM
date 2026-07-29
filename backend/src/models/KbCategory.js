const { DataTypes, Model } = require('sequelize');

// Knowledge Base category (folder). Articles optionally belong to one.
module.exports = (sequelize) => {
  class KbCategory extends Model {}

  KbCategory.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      // URL-safe identifier used by the public portal (/kb/c/:slug). Unique.
      slug: { type: DataTypes.STRING(180), allowNull: false, unique: true },
      description: { type: DataTypes.STRING(500), allowNull: true },
      // Emoji/short glyph shown next to the category (optional, cosmetic).
      icon: { type: DataTypes.STRING(16), allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'KbCategory',
      tableName: 'KbCategories',
      timestamps: true,
    }
  );

  return KbCategory;
};
