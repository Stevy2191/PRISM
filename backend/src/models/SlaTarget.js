const { DataTypes, Model } = require('sequelize');

// One policy's targets for one ticket type and priority. A null target means
// that clock is not tracked for that priority. useBusinessHours = false
// counts every minute even when the policy has a schedule.
module.exports = (sequelize) => {
  class SlaTarget extends Model {}

  SlaTarget.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      slaPolicyId: { type: DataTypes.INTEGER, allowNull: false },
      ticketType: { type: DataTypes.ENUM('incident', 'request', 'problem', 'change', 'task'), allowNull: false, defaultValue: 'incident' },
      priority: { type: DataTypes.ENUM('critical', 'high', 'medium', 'low'), allowNull: false },
      // The amount is minutes, or a count of business days when the clock's
      // unit is 'business_days'.
      assignMinutes: { type: DataTypes.INTEGER, allowNull: true },
      assignUnit: { type: DataTypes.ENUM('minutes', 'business_days'), allowNull: false, defaultValue: 'minutes' },
      responseMinutes: { type: DataTypes.INTEGER, allowNull: true },
      responseUnit: { type: DataTypes.ENUM('minutes', 'business_days'), allowNull: false, defaultValue: 'minutes' },
      resolutionMinutes: { type: DataTypes.INTEGER, allowNull: true },
      resolutionUnit: { type: DataTypes.ENUM('minutes', 'business_days'), allowNull: false, defaultValue: 'minutes' },
      useBusinessHours: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'SlaTarget',
      tableName: 'SlaTargets',
      timestamps: true,
    }
  );

  return SlaTarget;
};
