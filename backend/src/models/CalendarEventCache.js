const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CalendarEventCache extends Model {}

  CalendarEventCache.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      integrationId: { type: DataTypes.INTEGER, allowNull: false },
      externalEventId: { type: DataTypes.STRING(500), allowNull: false },
      title: { type: DataTypes.STRING(500), allowNull: false },
      startDate: { type: DataTypes.DATE, allowNull: false },
      endDate: { type: DataTypes.DATE, allowNull: true },
      isAllDay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      location: { type: DataTypes.STRING(500), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      // Set only on rows created by the PRISM -> external push direction —
      // see calendarPush.js. Null for normal pulled-in rows.
      prismEventType: { type: DataTypes.ENUM('ticket', 'project'), allowNull: true },
      prismEventId: { type: DataTypes.INTEGER, allowNull: true },
      lastFetched: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'CalendarEventCache',
      tableName: 'CalendarEventCaches',
      timestamps: true,
      updatedAt: false,
    }
  );

  return CalendarEventCache;
};
