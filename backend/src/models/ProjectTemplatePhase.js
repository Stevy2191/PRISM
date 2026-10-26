const { DataTypes, Model } = require('sequelize');

// A phase of a project template.
module.exports = (sequelize) => {
  class ProjectTemplatePhase extends Model {}

  ProjectTemplatePhase.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      templateId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      hourBudgetMinutes: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'ProjectTemplatePhase', tableName: 'ProjectTemplatePhases', timestamps: false }
  );

  return ProjectTemplatePhase;
};
