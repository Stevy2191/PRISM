const { DataTypes, Model } = require('sequelize');

// A company's SLA (CS): its support hours (a weekly schedule in its time
// zone, or around the clock), its holidays (Holiday), the warning point and
// its targets by ticket type and priority (SlaTarget). One row per company;
// the row with no company is the starting values (isDefault), copied when a
// company is created. See services/sla/.
module.exports = (sequelize) => {
  class SlaPolicy extends Model {}

  SlaPolicy.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      companyId: { type: DataTypes.INTEGER, allowNull: true, unique: true },
      timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'UTC' },
      is24x7: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // { monday: { enabled, start: 'HH:MM', end: 'HH:MM' }, ... }
      schedule: { type: DataTypes.JSON, allowNull: true },
      warnAtPercent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 75 },
    },
    {
      sequelize,
      modelName: 'SlaPolicy',
      tableName: 'SlaPolicies',
      timestamps: true,
    }
  );

  return SlaPolicy;
};
