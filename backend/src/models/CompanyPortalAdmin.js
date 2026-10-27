const { DataTypes, Model } = require('sequelize');

// A contact who is a portal admin for their company: in the client portal
// they see every ticket of that company, not only their own.
module.exports = (sequelize) => {
  class CompanyPortalAdmin extends Model {}

  CompanyPortalAdmin.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'CompanyPortalAdmin',
      tableName: 'CompanyPortalAdmins',
      timestamps: true,
      updatedAt: false,
    }
  );

  return CompanyPortalAdmin;
};
