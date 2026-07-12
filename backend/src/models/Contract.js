const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Contract extends Model {}

  Contract.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      vendor: { type: DataTypes.STRING(150), allowNull: true },
      contractType: {
        type: DataTypes.ENUM('support', 'maintenance', 'saas', 'lease', 'subscription', 'warranty', 'other'),
        allowNull: false,
        defaultValue: 'support',
      },
      startDate: { type: DataTypes.DATEONLY, allowNull: true },
      endDate: { type: DataTypes.DATEONLY, allowNull: true },
      renewalDate: { type: DataTypes.DATEONLY, allowNull: true },
      autoRenews: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      annualCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      totalValue: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      // Vendor-side contact — plain free-text fields, not a Contacts-module
      // FK, since this is who to call at the vendor, not a PRISM customer.
      contactPerson: { type: DataTypes.STRING(150), allowNull: true },
      contactEmail: { type: DataTypes.STRING(150), allowNull: true },
      contactPhone: { type: DataTypes.STRING(20), allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Contract',
      tableName: 'Contracts',
      timestamps: true,
    }
  );

  return Contract;
};
