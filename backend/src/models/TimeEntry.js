const { DataTypes, Model } = require('sequelize');

// The one time ledger (sub-project 3): every minute of work, on a ticket or a
// project, lives here. Exactly one of ticketId / projectId is set (a database
// check enforces it). userId is who the time is FOR; loggedById is who
// entered it. "When it was entered" is createdAt; entryDate is the work date
// in the organization's time zone.
module.exports = (sequelize) => {
  class TimeEntry extends Model {}

  TimeEntry.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      loggedById: { type: DataTypes.INTEGER, allowNull: true },
      entryDate: { type: DataTypes.DATEONLY, allowNull: false },
      // Set when known (timer, start/end picker); null for a plain duration.
      startTime: { type: DataTypes.DATE, allowNull: true },
      endTime: { type: DataTypes.DATE, allowNull: true },
      durationSeconds: { type: DataTypes.INTEGER, allowNull: false },
      billable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      workTypeId: { type: DataTypes.INTEGER, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true },
      // From userId's contractor rate (utils/laborCost.js); null for internal
      // staff, not 0. Recomputed whenever the duration or userId changes.
      laborCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    { sequelize, modelName: 'TimeEntry', tableName: 'TimeEntries', timestamps: true }
  );

  return TimeEntry;
};
