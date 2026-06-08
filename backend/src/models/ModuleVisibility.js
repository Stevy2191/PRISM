const { DataTypes, Model } = require('sequelize');

// Controls which sidebar modules are visible to which roles.
module.exports = (sequelize) => {
  class ModuleVisibility extends Model {}

  ModuleVisibility.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      moduleName: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      // JSON array of roles, e.g. ["admin","technician","requester"]
      visibleToRoles: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    },
    {
      sequelize,
      modelName: 'ModuleVisibility',
      tableName: 'ModuleVisibility',
      timestamps: false,
    }
  );

  return ModuleVisibility;
};
