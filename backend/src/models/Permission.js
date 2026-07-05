const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Permission extends Model {}

  Permission.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // e.g. "tickets.view_all", "projects.create" — matched against
      // req.user's resolved permission map by requirePermission().
      key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      label: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Permission',
      tableName: 'Permissions',
      timestamps: true,
      updatedAt: false,
    }
  );

  return Permission;
};
