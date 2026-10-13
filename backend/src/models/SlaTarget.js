const { DataTypes, Model } = require('sequelize');

// One policy's targets for one priority, in minutes. A null target means
// that clock is not tracked for that priority. useBusinessHours = false
// counts every minute even when the policy has a schedule.
module.exports = (sequelize) => {
  class SlaTarget extends Model {}

  SlaTarget.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      slaPolicyId: { type: DataTypes.INTEGER, allowNull: false },
      priority: { type: DataTypes.ENUM('critical', 'high', 'medium', 'low'), allowNull: false },
      assignMinutes: { type: DataTypes.INTEGER, allowNull: true },
      responseMinutes: { type: DataTypes.INTEGER, allowNull: true },
      resolutionMinutes: { type: DataTypes.INTEGER, allowNull: true },
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
