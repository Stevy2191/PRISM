const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class RolePermission extends Model {}

  RolePermission.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      roleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      permissionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      granted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'RolePermission',
      tableName: 'RolePermissions',
      timestamps: false,
    }
  );

  return RolePermission;
};
