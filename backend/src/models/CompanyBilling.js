const { DataTypes, Model } = require('sequelize');

// A customer's billing settings (Phase 3). No row = every default.
// Null rate, terms or tax rate = the install's default.
module.exports = (sequelize) => {
  class CompanyBilling extends Model {}
  CompanyBilling.init(
    {
      companyId: { type: DataTypes.INTEGER, primaryKey: true },
      chargeTax: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      taxExempt: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      exemptCertificateFile: { type: DataTypes.STRING(255), allowNull: true },
      exemptCertificateName: { type: DataTypes.STRING(255), allowNull: true },
      exemptExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
      taxRateId: { type: DataTypes.INTEGER, allowNull: true },
      termsDays: { type: DataTypes.INTEGER, allowNull: true },
      invoiceTiming: { type: DataTypes.ENUM('monthly', 'on_close'), allowNull: false, defaultValue: 'monthly' },
      hourlyRate: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      afterHoursRate: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      tripCharge: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    },
    { sequelize, modelName: 'CompanyBilling', tableName: 'CompanyBilling' }
  );
  return CompanyBilling;
};
