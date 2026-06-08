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
