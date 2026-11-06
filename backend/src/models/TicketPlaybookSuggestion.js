const { DataTypes, Model } = require('sequelize');

// A playbook a workflow rule suggested for a ticket (PB). Never applied by
// itself; a person clicks Apply, or dismisses it (dismissedAt).
module.exports = (sequelize) => {
  class TicketPlaybookSuggestion extends Model {}

  TicketPlaybookSuggestion.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      playbookId: { type: DataTypes.INTEGER, allowNull: false },
      ruleId: { type: DataTypes.INTEGER, allowNull: true },
      dismissedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize, modelName: 'TicketPlaybookSuggestion', tableName: 'TicketPlaybookSuggestions', timestamps: true, updatedAt: false,
    }
  );

  return TicketPlaybookSuggestion;
};
