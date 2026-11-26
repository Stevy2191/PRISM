const { DataTypes, Model } = require('sequelize');

// One person's week of logged time (Phase 3, step 3).
module.exports = (sequelize) => {
  class Timesheet extends Model {}
  Timesheet.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      weekStart: { type: DataTypes.DATEONLY, allowNull: false },
      status: { type: DataTypes.ENUM('open', 'submitted', 'approved', 'rejected'), allowNull: false, defaultValue: 'open' },
      totalSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      submittedAt: { type: DataTypes.DATE, allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decidedById: { type: DataTypes.INTEGER, allowNull: true },
      note: { type: DataTypes.STRING(1000), allowNull: true },
      remindedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Timesheet', tableName: 'Timesheets' }
  );
  return Timesheet;
};
