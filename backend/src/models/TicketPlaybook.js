const { DataTypes, Model } = require('sequelize');

// A playbook applied to a ticket (PB), for a person (contactId) when the
// playbook needs one. snapshot: the playbook as it was when applied.
module.exports = (sequelize) => {
  class TicketPlaybook extends Model {}

  TicketPlaybook.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      playbookId: { type: DataTypes.INTEGER, allowNull: false },
      snapshot: { type: DataTypes.JSON, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: true },
      appliedBy: { type: DataTypes.INTEGER, allowNull: true },
      appliedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { sequelize, modelName: 'TicketPlaybook', tableName: 'TicketPlaybooks', timestamps: true }
  );

  return TicketPlaybook;
};
