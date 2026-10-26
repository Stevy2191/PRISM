const { DataTypes, Model } = require('sequelize');

// A task, subtask or milestone of a project template; dates are day offsets.
module.exports = (sequelize) => {
  class ProjectTemplateTask extends Model {}

  ProjectTemplateTask.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      templateId: { type: DataTypes.INTEGER, allowNull: false },
      templatePhaseId: { type: DataTypes.INTEGER, allowNull: true },
      parentId: { type: DataTypes.INTEGER, allowNull: true },
      title: { type: DataTypes.STRING(500), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      // Day 1 is the project's first day. A milestone has lengthDays 0.
      startDay: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      lengthDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      estimateMinutes: { type: DataTypes.INTEGER, allowNull: true },
      priority: { type: DataTypes.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
      isMilestone: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'ProjectTemplateTask', tableName: 'ProjectTemplateTasks', timestamps: false }
  );

  return ProjectTemplateTask;
};
