const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class BusinessHours extends Model {}

  BusinessHours.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      // null departmentId = global / default schedule.
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'UTC' },
      // { monday: { start: '09:00', end: '17:00', enabled: true }, ... }
      schedule: { type: DataTypes.JSON, allowNull: true },
      // When true, every day is open 00:00-23:59 regardless of `schedule`,
      // which is left as-is so disabling 24/7 restores the prior manual days.
      is24x7: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // null = no holiday list linked; dates in the linked list are closed
      // days for this schedule, overriding the normal day-of-week hours.
      holidayListId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'BusinessHours',
      tableName: 'BusinessHours',
      timestamps: true,
      updatedAt: false,
    }
  );

  return BusinessHours;
};
