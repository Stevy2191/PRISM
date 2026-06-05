const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AuditLog extends Model {}

  AuditLog.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      entityType: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      entityId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      meta: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'AuditLogs',
      timestamps: true,
      updatedAt: false,
    }
  );

  return AuditLog;
};
