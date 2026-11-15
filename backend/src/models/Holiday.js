const { DataTypes, Model } = require('sequelize');

// A day a company's SLA clock stops (CS). Your own company's are also the
// days your staff are off in Workload.
module.exports = (sequelize) => {
  class Holiday extends Model {}

  Holiday.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      slaPolicyId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false },
    },
    {
      sequelize,
      modelName: 'Holiday',
      tableName: 'Holidays',
      timestamps: false,
    }
  );

  return Holiday;
};
