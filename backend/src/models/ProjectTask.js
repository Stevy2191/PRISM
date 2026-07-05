const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectTask extends Model {}

  ProjectTask.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      // FK to ProjectStatuses.id (unlike Project.status, which matches by
      // name — tasks/subtasks reference the row directly).
      statusId: { type: DataTypes.INTEGER, allowNull: false },
      priority: {
        type: DataTypes.ENUM('urgent', 'high', 'medium', 'low'),
        allowNull: false,
        defaultValue: 'medium',
      },
      assignedToUserId: { type: DataTypes.INTEGER, allowNull: true },
      dueDate: { type: DataTypes.DATEONLY, allowNull: true },
      linkedTicketId: { type: DataTypes.INTEGER, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ProjectTask',
      tableName: 'ProjectTasks',
      timestamps: true,
    }
  );

  return ProjectTask;
};
