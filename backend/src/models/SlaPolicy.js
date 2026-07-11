const { DataTypes, Model } = require('sequelize');

// One row per ticket priority — response/resolution time targets. Config
// storage only for now: nothing currently computes against these targets or
// enforces them (no business-hours-aware due-date calculator exists in the
// app yet, see project notes) — this is the settings surface a future
// SLA-tracking/compliance feature would read from.
module.exports = (sequelize) => {
  class SlaPolicy extends Model {}

  SlaPolicy.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      priority: { type: DataTypes.ENUM('critical', 'high', 'medium', 'low'), allowNull: false, unique: true },
      firstResponseHours: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 4 },
      resolutionHours: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 24 },
      useBusinessHours: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
