const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class SystemAuditLog extends Model {}

  SystemAuditLog.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Who made the change. Null for system-initiated changes (none today).
      actorUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Whose roles/permissions changed.
      targetUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      detail: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'SystemAuditLog',
      tableName: 'SystemAuditLogs',
      timestamps: true,
      updatedAt: false,
    }
  );

  return SystemAuditLog;
};
