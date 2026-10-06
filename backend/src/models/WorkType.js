const { DataTypes, Model } = require('sequelize');

// What kind of work a time entry is (Remote support, On-site, ...). Billable
// defaults from it; the money phase attaches rates here later.
module.exports = (sequelize) => {
  class WorkType extends Model {}

  WorkType.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      billableDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'WorkType', tableName: 'WorkTypes', timestamps: true }
  );

  return WorkType;
};
