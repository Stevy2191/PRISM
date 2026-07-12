const { DataTypes, Model } = require('sequelize');

// Admin-defined field that appears dynamically on the asset form/detail
// page for a given category — mirrors CustomField for tickets. fieldKey is
// unique per-category (not globally), so the same semantic key (e.g.
// "subscriptionProvider") can be reused across several categories.
module.exports = (sequelize) => {
  class AssetCategoryField extends Model {}

  AssetCategoryField.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      categoryId: { type: DataTypes.INTEGER, allowNull: false },
      fieldKey: { type: DataTypes.STRING(100), allowNull: false },
      label: { type: DataTypes.STRING(255), allowNull: false },
      fieldType: {
        type: DataTypes.ENUM('text', 'number', 'date', 'dropdown', 'toggle', 'phone', 'email'),
        allowNull: false,
        defaultValue: 'text',
      },
      // JSON array of option strings — dropdown only.
      options: { type: DataTypes.JSON, allowNull: true },
      required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // Seeded built-in fields (see migration 20260101000041) — viewable and
      // extendable but not deletable from Settings -> Asset Categories.
      isBuiltIn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'AssetCategoryField',
      tableName: 'AssetCategoryFields',
      timestamps: true,
      indexes: [{ unique: true, fields: ['categoryId', 'fieldKey'] }],
    }
  );

  return AssetCategoryField;
};
