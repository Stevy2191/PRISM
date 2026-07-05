const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class UserRole extends Model {}

  UserRole.init(
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
      roleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      assignedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'UserRole',
      tableName: 'UserRoles',
      timestamps: false,
    }
  );

  return UserRole;
};
