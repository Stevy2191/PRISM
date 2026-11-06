const { DataTypes, Model } = require('sequelize');

// A form on a ticket (PB), shown as one ticket task (taskId). It keeps the
// form version it was created from, and is for one device (assetId) when the
// form is used per device.
// answers: { itemKey: value }; a step's value is { done, by, at, note? }.
// Secure values are not here: see TicketFormSecret.
module.exports = (sequelize) => {
  class TicketForm extends Model {}

  TicketForm.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      ticketPlaybookId: { type: DataTypes.INTEGER, allowNull: true },
      formVersionId: { type: DataTypes.INTEGER, allowNull: false },
      assetId: { type: DataTypes.INTEGER, allowNull: true },
      taskId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      answers: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      state: { type: DataTypes.ENUM('open', 'finished', 'skipped'), allowNull: false, defaultValue: 'open' },
      skipReason: { type: DataTypes.STRING(500), allowNull: true },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
      finishedBy: { type: DataTypes.INTEGER, allowNull: true },
      actionDoneAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'TicketForm', tableName: 'TicketForms', timestamps: true }
  );

  return TicketForm;
};
