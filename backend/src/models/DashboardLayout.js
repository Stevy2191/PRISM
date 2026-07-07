const { DataTypes, Model } = require('sequelize');

// One row per user: their customized dashboard panel layout. Absence of a
// row (not a special layout value) means "use the built-in default."
module.exports = (sequelize) => {
  class DashboardLayout extends Model {}

  DashboardLayout.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      layout: { type: DataTypes.JSON, allowNull: false },
    },
    {
      sequelize,
      modelName: 'DashboardLayout',
      tableName: 'DashboardLayouts',
      timestamps: true,
    }
  );

  return DashboardLayout;
};
