const { DataTypes, Model } = require('sequelize');

// One row per inbound email the poller looked at — including ones it
// deliberately ignored or failed to process — so Settings -> Email Log can
// answer "why didn't this email create a ticket?" without digging through
// server logs.
module.exports = (sequelize) => {
  class EmailProcessingLog extends Model {}

  EmailProcessingLog.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      messageId: { type: DataTypes.STRING(500), allowNull: true },
      fromEmail: { type: DataTypes.STRING(255), allowNull: true },
      subject: { type: DataTypes.STRING(998), allowNull: true },
      action: { type: DataTypes.ENUM('ticket_created', 'reply_added', 'ignored', 'failed'), allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      processedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      error: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'EmailProcessingLog',
      tableName: 'EmailProcessingLogs',
      timestamps: true,
    }
  );

  return EmailProcessingLog;
};
