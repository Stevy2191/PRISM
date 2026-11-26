const { DataTypes, Model } = require('sequelize');

// A recurring customer's agreement (Phase 3, step 3).
module.exports = (sequelize) => {
  class Agreement extends Model {}
  Agreement.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(200), allowNull: false },
      slaPolicyId: { type: DataTypes.INTEGER, allowNull: true },
      startsOn: { type: DataTypes.DATEONLY, allowNull: false },
      endsOn: { type: DataTypes.DATEONLY, allowNull: true },
      status: { type: DataTypes.ENUM('active', 'cancelled'), allowNull: false, defaultValue: 'active' },
      cancelledOn: { type: DataTypes.DATEONLY, allowNull: true },
      termsDays: { type: DataTypes.INTEGER, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Agreement', tableName: 'Agreements' }
  );
  return Agreement;
};
