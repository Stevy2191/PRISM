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
      minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      note: {
        type: DataTypes.TEXT,
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
