const { DataTypes, Model } = require('sequelize');

// A single running timer per user (server-side so it resumes across devices),
// on a ticket or a project, optionally on one of its tasks. Stopping or
// switching writes the elapsed time to the ledger (services/time).
module.exports = (sequelize) => {
  class ActiveTimer extends Model {}

  ActiveTimer.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      entityType: { type: DataTypes.ENUM('ticket', 'project'), allowNull: false },
      entityId: { type: DataTypes.INTEGER, allowNull: false },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      label: { type: DataTypes.STRING(255), allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'ActiveTimer',
      tableName: 'ActiveTimers',
      timestamps: false,
    }
  );

  return ActiveTimer;
};
