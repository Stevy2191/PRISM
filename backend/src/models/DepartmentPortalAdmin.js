const { DataTypes, Model } = require('sequelize');

// A contact who is a portal admin for their department: in the client portal
// they see every ticket of that department, not only their own.
module.exports = (sequelize) => {
  class DepartmentPortalAdmin extends Model {}

  DepartmentPortalAdmin.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'DepartmentPortalAdmin',
      tableName: 'DepartmentPortalAdmins',
      timestamps: true,
      updatedAt: false,
    }
  );

  return DepartmentPortalAdmin;
};
