const { DataTypes, Model } = require('sequelize');

// A ticket template plus a schedule. The scheduler makes one ticket per due
// run (services/recurring). createdById is whoever last saved the rule: the
// run is checked against, and made with the access of, that person.
module.exports = (sequelize) => {
  class RecurringTicket extends Model {}

  RecurringTicket.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      priority: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
      type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'request' },
      contactId: { type: DataTypes.INTEGER, allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      teamId: { type: DataTypes.INTEGER, allowNull: true },
      assigneeId: { type: DataTypes.INTEGER, allowNull: true },
      tasks: { type: DataTypes.JSON, allowNull: true },
      frequency: { type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly'), allowNull: false },
      interval: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      weekdays: { type: DataTypes.JSON, allowNull: true },
      dayOfMonth: { type: DataTypes.INTEGER, allowNull: true },
      monthOfYear: { type: DataTypes.INTEGER, allowNull: true },
      timeOfDay: { type: DataTypes.STRING(5), allowNull: false },
      timezone: { type: DataTypes.STRING(64), allowNull: false },
      startDate: { type: DataTypes.DATEONLY, allowNull: false },
      endDate: { type: DataTypes.DATEONLY, allowNull: true },
      nextRunAt: { type: DataTypes.DATE, allowNull: true },
      lastRunAt: { type: DataTypes.DATE, allowNull: true },
      lastTicketId: { type: DataTypes.INTEGER, allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      lastError: { type: DataTypes.STRING(500), allowNull: true },
      createdById: { type: DataTypes.INTEGER, allowNull: false },
    },
    { sequelize, modelName: 'RecurringTicket', tableName: 'RecurringTickets', timestamps: true }
  );

  return RecurringTicket;
};
