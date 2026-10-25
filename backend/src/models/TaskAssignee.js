const { DataTypes, Model } = require('sequelize');

// Helpers on a task. Tasks.assigneeId stays the main assignee.
module.exports = (sequelize) => {
  class TaskAssignee extends Model {}

  TaskAssignee.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      taskId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      addedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'TaskAssignee', tableName: 'TaskAssignees', timestamps: true, updatedAt: false }
  );

  return TaskAssignee;
};
