const { DataTypes, Model } = require('sequelize');

// A named SLA policy: a business-hours schedule (null = 24x7), the warning
// point, and per-priority targets (SlaTarget). Exactly one is the default;
// a company may carry its own (Company.slaPolicyId). See services/sla/.
module.exports = (sequelize) => {
  class SlaPolicy extends Model {}

  SlaPolicy.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      businessHoursId: { type: DataTypes.INTEGER, allowNull: true },
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
