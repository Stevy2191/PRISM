const { DataTypes, Model } = require('sequelize');

// Task statuses: one editable list per scope ('ticket' | 'project'), separate
// from the ticket and project status lists (spec decision: four lists).
module.exports = (sequelize) => {
  class TaskStatus extends Model {}

  TaskStatus.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      scope: { type: DataTypes.ENUM('ticket', 'project'), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#3b82f6' },
      behaviorType: { type: DataTypes.ENUM('open', 'closed', 'archived'), allowNull: false, defaultValue: 'open' },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isProtected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, modelName: 'TaskStatus', tableName: 'TaskStatuses', timestamps: true, updatedAt: false }
  );

  return TaskStatus;
};
