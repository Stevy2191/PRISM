const { DataTypes, Model } = require('sequelize');

// The successor waits while the predecessor is not done (derived, not stored).
module.exports = (sequelize) => {
  class TaskDependency extends Model {}

  TaskDependency.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      predecessorId: { type: DataTypes.INTEGER, allowNull: false },
      successorId: { type: DataTypes.INTEGER, allowNull: false },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'TaskDependency', tableName: 'TaskDependencies', timestamps: true, updatedAt: false }
  );

  return TaskDependency;
};
