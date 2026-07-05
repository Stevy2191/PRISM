const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class UserPermissionOverride extends Model {}

  UserPermissionOverride.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Not a FK to Permissions.id on purpose — overrides are keyed by the
      // stable string key so they survive a permission row being re-seeded.
      permissionKey: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      granted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // Null = never expires. Set = override stops applying after this time.
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      grantedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'UserPermissionOverride',
      tableName: 'UserPermissionOverrides',
      timestamps: true,
      updatedAt: false,
    }
  );

  return UserPermissionOverride;
};
