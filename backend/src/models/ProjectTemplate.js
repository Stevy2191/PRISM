const { DataTypes, Model } = require('sequelize');

// A reusable project structure (sub-project 6). Holds no company, people, time, files or costs.
module.exports = (sequelize) => {
  class ProjectTemplate extends Model {}

  ProjectTemplate.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      // Minutes; null = none.
      hourBudgetMinutes: { type: DataTypes.INTEGER, allowNull: true },
      tags: { type: DataTypes.JSON, allowNull: true },
      sourceProjectId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'ProjectTemplate', tableName: 'ProjectTemplates', timestamps: true }
  );

  return ProjectTemplate;
};
