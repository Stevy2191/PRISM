const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Notification extends Model {}

  Notification.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('reply', 'assigned', 'overdue', 'comment', 'due_soon', 'status_change', 'watcher_update', 'workflow', 'sla_warning', 'sla_breached', 'new_in_queue', 'recurring_paused', 'virus_blocked', 'scanner_unavailable', 'task_unblocked', 'task_added', 'budget_warning', 'budget_reached'),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'Notification',
      tableName: 'Notifications',
      timestamps: true,
    }
  );

  return Notification;
};
