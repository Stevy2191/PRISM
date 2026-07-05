const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Role extends Model {}

  Role.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Null = system-wide role. Set = role only meaningful/assignable within
      // that department (e.g. a per-department manager variant).
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // System roles (seeded on migration) cannot be deleted from the UI.
      isSystemRole: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'Role',
      tableName: 'Roles',
      timestamps: true,
    }
  );

  return Role;
};
