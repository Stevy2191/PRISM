const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class TicketStatus extends Model {}

  TicketStatus.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#3b82f6' },
      behaviorType: {
        // on_hold (user decision 2026-10-15) never counts as closed: the SLA
        // keeps running and the ticket stays in open lists.
        type: DataTypes.ENUM('open', 'closed', 'archived', 'on_hold'),
        allowNull: false,
        defaultValue: 'open',
      },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isProtected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // 'user_responded' | 'waiting_on_user': statuses replies move tickets
      // into automatically (see services/statusMoves.js).
      systemKey: { type: DataTypes.STRING(32), allowNull: true, unique: true },
      // Time in this status counts as waiting on the customer (reports and
      // the ticket page; always on for Waiting on User).
      countsAsWaiting: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'TicketStatus',
      tableName: 'TicketStatuses',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketStatus;
};
