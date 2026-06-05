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
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
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
    }
  );

  return TimeEntry;
};
