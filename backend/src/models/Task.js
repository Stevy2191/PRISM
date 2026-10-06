const { DataTypes, Model } = require('sequelize');

// One task model for tickets and projects (sub-project 3). Exactly one of
// ticketId / projectId is set (a database check enforces it); a subtask has
// parentTaskId and the same parent, one level deep. A task has no companyId:
// it follows its ticket or project for company and access.
module.exports = (sequelize) => {
  class Task extends Model {}

  Task.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      parentTaskId: { type: DataTypes.INTEGER, allowNull: true },
      // IT-P00012-T04 on projects, #00012-T04 on tickets; subtasks add -S02.
      code: { type: DataTypes.STRING(60), allowNull: true, unique: true },
      title: { type: DataTypes.STRING(500), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      // TaskStatuses.id, in the scope matching the parent (ticket | project).
      statusId: { type: DataTypes.INTEGER, allowNull: false },
      priority: { type: DataTypes.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
      assigneeId: { type: DataTypes.INTEGER, allowNull: true },
      dueDate: { type: DataTypes.DATEONLY, allowNull: true },
      estimateMinutes: { type: DataTypes.INTEGER, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      // Project tasks only; same company as the project.
      linkedTicketId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Task', tableName: 'Tasks', timestamps: true }
  );

  return Task;
};
