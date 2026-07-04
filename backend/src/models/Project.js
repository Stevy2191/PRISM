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
      // Free-form string matching a ProjectStatus row's `name` (see the
      // matching note on Ticket.status).
      status: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Active',
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
