const { DataTypes, Model } = require('sequelize');

// A company this role adds to its holders' reach when they aren't "all companies"
// (see permissionService.getUserCompanyIds).
module.exports = (sequelize) => {
  class RoleCompanyAccess extends Model {}
  RoleCompanyAccess.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      roleId: { type: DataTypes.INTEGER, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
    },
    { sequelize, modelName: 'RoleCompanyAccess', tableName: 'RoleCompanyAccess', timestamps: true, updatedAt: false }
  );
  return RoleCompanyAccess;
};
