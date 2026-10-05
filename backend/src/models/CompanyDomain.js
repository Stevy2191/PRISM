const { DataTypes, Model } = require('sequelize');

// An email domain that identifies a company (inbound email files new
// contacts under it). Unique across companies; free-mail domains refused.
module.exports = (sequelize) => {
  class CompanyDomain extends Model {}
  CompanyDomain.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      domain: { type: DataTypes.STRING(253), allowNull: false, unique: true },
    },
    { sequelize, modelName: 'CompanyDomain', tableName: 'CompanyDomains', timestamps: true }
  );
  return CompanyDomain;
};
