const { DataTypes, Model } = require('sequelize');

// A company this user can reach when they aren't "all companies"
// (see permissionService.getUserCompanyIds).
module.exports = (sequelize) => {
  class UserCompanyAccess extends Model {}
  UserCompanyAccess.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
    },
    { sequelize, modelName: 'UserCompanyAccess', tableName: 'UserCompanyAccess', timestamps: true, updatedAt: false }
  );
  return UserCompanyAccess;
};
