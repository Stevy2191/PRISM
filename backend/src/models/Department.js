const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Department extends Model {}

  Department.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Unique within a company (index departments_company_name), not
      // across the install: a client may have its own "HR".
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Short code used in project IDs (e.g. "IT", "HR", "MNT").
      shortCode: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      // Role auto-assigned to new users added to this department.
      defaultRoleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Department',
      tableName: 'Departments',
      timestamps: true,
      updatedAt: false,
    }
  );

  return Department;
};
