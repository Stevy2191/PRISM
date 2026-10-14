const { DataTypes, Model } = require('sequelize');

// One move of a ticket's SLA due date: an extension (later, with a reason)
// or an adjustment (anything else; needs tickets.adjust_sla_due, or made by
// a workflow rule — userId null). See services/sla/ticketSla.changeDueDate.
module.exports = (sequelize) => {
  class TicketDueDateChange extends Model {}

  TicketDueDateChange.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      fromDueAt: { type: DataTypes.DATE, allowNull: true },
      toDueAt: { type: DataTypes.DATE, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: true },
      kind: { type: DataTypes.ENUM('extension', 'adjustment'), allowNull: false },
    },
    {
      sequelize,
      modelName: 'TicketDueDateChange',
      tableName: 'TicketDueDateChanges',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketDueDateChange;
};
