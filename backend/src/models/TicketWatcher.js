const { DataTypes, Model } = require('sequelize');

// Users who get notified on ticket create/comment/status-change without
// necessarily being the requester or assignee.
module.exports = (sequelize) => {
  class TicketWatcher extends Model {}

  TicketWatcher.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'TicketWatcher',
      tableName: 'TicketWatchers',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketWatcher;
};
