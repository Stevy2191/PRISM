const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LicenseContact extends Model {}

  LicenseContact.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenseId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      assignedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LicenseContact',
      tableName: 'LicenseContacts',
      timestamps: false,
    }
  );

  return LicenseContact;
};
