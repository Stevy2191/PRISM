const { DataTypes, Model } = require('sequelize');

// A lightweight per-ticket checklist item (distinct from the "task" ticket
// type and from project Milestones).
module.exports = (sequelize) => {
  class TicketTask extends Model {}

  TicketTask.init(
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
      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      completed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      assigneeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TicketTask',
      tableName: 'TicketTasks',
      timestamps: true,
    }
  );

  return TicketTask;
};
