const { DataTypes, Model } = require('sequelize');

// A named stage of a project; its dates come from its tasks (phaseSpan).
module.exports = (sequelize) => {
  class ProjectPhase extends Model {}

  ProjectPhase.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Minutes; null = no budget for this phase.
      hourBudgetMinutes: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'ProjectPhase', tableName: 'ProjectPhases', timestamps: true }
  );

  return ProjectPhase;
};
