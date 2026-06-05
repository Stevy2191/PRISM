const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Ticket extends Model {}

  Ticket.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('open', 'in_progress', 'on_hold', 'resolved', 'closed'),
        allowNull: false,
        defaultValue: 'open',
      },
      priority: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'medium',
      },
      type: {
        type: DataTypes.ENUM('incident', 'request', 'task', 'change'),
        allowNull: false,
        defaultValue: 'request',
      },
      assigneeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      requesterId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Ticket',
      tableName: 'Tickets',
      timestamps: true,
      hooks: {
        // Keep resolvedAt in sync with status transitions.
        beforeSave: (ticket) => {
          if (ticket.changed('status')) {
            const isClosed = ticket.status === 'resolved' || ticket.status === 'closed';
            if (isClosed && !ticket.resolvedAt) {
              ticket.resolvedAt = new Date();
            } else if (!isClosed) {
              ticket.resolvedAt = null;
            }
          }
        },
      },
    }
  );

  return Ticket;
};
