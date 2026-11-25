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
      // Short code (HR, FIN): every department has one, unique within its
      // company; it sits in project numbers (WC-HR-P0007).
      // Phase 3: the support tier its people get unless set on them.
      defaultSupportTier: { type: DataTypes.ENUM('full', 'light', 'none'), allowNull: false, defaultValue: 'full' },
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
