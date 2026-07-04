const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class TimeEntry extends Model {}

  TimeEntry.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Time may be logged against a ticket OR directly against a project.
      // Exactly one of ticketId / projectId is set (enforced by validation).
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Who actually created the record — usually the same as userId, but an
      // admin/team lead can log time attributed to a different tech.
      loggedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // The date the work was actually done — editable by the tech,
      // independent of loggedAt (when the record itself was created).
      entryDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: () => new Date().toISOString().slice(0, 10),
      },
      // Set when the entry was created via the start/end time picker; left
      // null for legacy duration-only entries, which keep displaying from
      // `minutes` instead.
      startTime: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endTime: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Precise duration in seconds (endTime - startTime) when available;
      // `minutes` stays populated too (rounded) so existing reports/dashboard
      // aggregation elsewhere in the app keeps working unchanged.
      durationSeconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      loggedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: 'TimeEntry',
      tableName: 'TimeEntries',
      timestamps: false,
      validate: {
        eitherTicketOrProject() {
          if (!this.ticketId && !this.projectId) {
            throw new Error('A time entry must reference either a ticket or a project');
          }
          if (this.ticketId && this.projectId) {
            throw new Error('A time entry cannot reference both a ticket and a project');
          }
        },
      },
    }
  );

  return TimeEntry;
};
