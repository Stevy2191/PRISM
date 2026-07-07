const { DataTypes, Model } = require('sequelize');

// One row per AD contact sync run — powers the "Sync log" viewer in
// Settings -> AD Contact Sync.
module.exports = (sequelize) => {
  class AdSyncLog extends Model {}

  AdSyncLog.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.ENUM('running', 'success', 'failed'), allowNull: false, defaultValue: 'running' },
      usersProcessed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      contactsCreated: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      contactsUpdated: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      contactsDeactivated: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      errorDetails: { type: DataTypes.JSON, allowNull: true },
      triggeredBy: { type: DataTypes.ENUM('manual', 'scheduled'), allowNull: false, defaultValue: 'scheduled' },
    },
    {
      sequelize,
      modelName: 'AdSyncLog',
      tableName: 'AdSyncLogs',
      timestamps: false,
    }
  );

  return AdSyncLog;
};
