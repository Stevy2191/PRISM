const { DataTypes, Model } = require('sequelize');

// A single running timer per user (server-side so it resumes across devices).
// Stopping/switching converts elapsed time into a TimeEntry.
module.exports = (sequelize) => {
  class ActiveTimer extends Model {}

  ActiveTimer.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      entityType: { type: DataTypes.ENUM('ticket', 'project'), allowNull: false },
      entityId: { type: DataTypes.INTEGER, allowNull: false },
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
