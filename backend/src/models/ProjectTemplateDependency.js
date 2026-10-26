const { DataTypes, Model } = require('sequelize');

// Finish-to-start link between two top-level template tasks.
module.exports = (sequelize) => {
  class ProjectTemplateDependency extends Model {}

  ProjectTemplateDependency.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      predecessorId: { type: DataTypes.INTEGER, allowNull: false },
      successorId: { type: DataTypes.INTEGER, allowNull: false },
    },
    { sequelize, modelName: 'ProjectTemplateDependency', tableName: 'ProjectTemplateDependencies', timestamps: false }
  );

  return ProjectTemplateDependency;
};
