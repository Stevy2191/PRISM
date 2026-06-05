const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Project extends Model {}

  Project.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'on_hold', 'completed', 'archived'),
        allowNull: false,
        defaultValue: 'active',
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      ownerId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Project',
      tableName: 'Projects',
      timestamps: true,
    }
  );

  return Project;
};
