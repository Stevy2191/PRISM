const { DataTypes, Model } = require('sequelize');

// A client, a vendor (or both), or the organization itself (isInternal —
// exactly one, created by migration). See the client-companies spec.
module.exports = (sequelize) => {
  class Company extends Model {}
  Company.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      isInternal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isClient: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isVendor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      accountManagerId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Company', tableName: 'Companies', timestamps: true }
  );
  return Company;
};
