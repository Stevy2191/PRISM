const { DataTypes, Model } = require('sequelize');

// Dedicated project time-logging table — distinct from the ticket-oriented
// TimeEntries table (which previously also carried a nullable projectId;
// see migration 19). userId is who actually logged the entry, loggedForUserId
// is who the time is credited to when a lead/admin logs on someone else's
// behalf (defaults to userId).
module.exports = (sequelize) => {
  class ProjectTimeEntry extends Model {}

  ProjectTimeEntry.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      loggedForUserId: { type: DataTypes.INTEGER, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      startTime: { type: DataTypes.DATE, allowNull: true },
      endTime: { type: DataTypes.DATE, allowNull: true },
      durationSeconds: { type: DataTypes.INTEGER, allowNull: true },
      entryDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: () => new Date().toISOString().slice(0, 10),
      },
      // Set at creation time from loggedForUserId (the contractor doing the
      // work) — see utils/laborCost.js. Null for internal staff, not 0.
      laborCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    {
      sequelize,
      modelName: 'ProjectTimeEntry',
      tableName: 'ProjectTimeEntries',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ProjectTimeEntry;
};
