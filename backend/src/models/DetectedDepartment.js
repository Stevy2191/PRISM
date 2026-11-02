const { DataTypes, Model } = require('sequelize');

// A department name Microsoft 365 reports for a company's sync-group members
// that matches no PRISM department of that company (Microsoft 365, 7b). Staff
// create a department from it or map it to an existing one
// (mappedDepartmentId); either way the name then resolves on every sync.
// normalized: trimmed, spaces collapsed, lower-case — unique per company.
module.exports = (sequelize) => {
  class DetectedDepartment extends Model {}

  DetectedDepartment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      normalized: { type: DataTypes.STRING(150), allowNull: false },
      // Sync-group members carrying this name, as of the last sync.
      peopleCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      mappedDepartmentId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'DetectedDepartment', tableName: 'DetectedDepartments', timestamps: true }
  );

  return DetectedDepartment;
};
