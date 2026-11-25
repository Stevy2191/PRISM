'use strict';

// Tax (Phase 3, step 1): tax rates, tax categories with the share of a
// charge that is taxable, and each customer's billing settings.
// The seeded shares are a starting point for Texas and must be confirmed
// with a CPA (managed and remote IT services as "data processing", 80 %).

const CATEGORIES = [
  ['Parts and equipment', '100'],
  ['Managed services', '80'],
  ['Remote support', '80'],
  ['On-site labor', '100'],
  ['Cabling', '100'],
  ['Licenses', '100'],
  ['Fees', '0'],
];

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  CATEGORIES,
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const tables = await tableNames(qi);
    const stamps = { createdAt: { type: dt.DATE, allowNull: false }, updatedAt: { type: dt.DATE, allowNull: false } };
    if (!tables.includes('TaxRates')) {
      await qi.createTable('TaxRates', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(100), allowNull: false },
        ratePercent: { type: dt.DECIMAL(7, 4), allowNull: false },
        isDefault: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        active: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps,
      });
    }
    if (!tables.includes('TaxCategories')) {
      await qi.createTable('TaxCategories', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(100), allowNull: false, unique: true },
        taxablePercent: { type: dt.DECIMAL(7, 4), allowNull: false },
        active: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps,
      });
      const now = new Date();
      await qi.bulkInsert('TaxCategories', CATEGORIES.map(([name, taxablePercent]) => ({
        name, taxablePercent, active: true, createdAt: now, updatedAt: now,
      })));
    }
    if (!tables.includes('CompanyBilling')) {
      await qi.createTable('CompanyBilling', {
        companyId: {
          type: dt.INTEGER, primaryKey: true, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE',
        },
        chargeTax: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        taxExempt: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        exemptCertificateFile: { type: dt.STRING(255), allowNull: true },
        exemptCertificateName: { type: dt.STRING(255), allowNull: true },
        exemptExpiresOn: { type: dt.DATEONLY, allowNull: true },
        taxRateId: {
          type: dt.INTEGER, allowNull: true, references: { model: 'TaxRates', key: 'id' }, onDelete: 'SET NULL',
        },
        termsDays: { type: dt.INTEGER, allowNull: true },
        invoiceTiming: { type: dt.ENUM('monthly', 'on_close'), allowNull: false, defaultValue: 'monthly' },
        hourlyRate: { type: dt.DECIMAL(12, 2), allowNull: true },
        afterHoursRate: { type: dt.DECIMAL(12, 2), allowNull: true },
        tripCharge: { type: dt.DECIMAL(12, 2), allowNull: true },
        ...stamps,
      });
    }
  },

  down: async (queryInterface) => {
    const tables = await tableNames(queryInterface);
    if (tables.includes('CompanyBilling')) await queryInterface.dropTable('CompanyBilling');
    if (tables.includes('TaxCategories')) await queryInterface.dropTable('TaxCategories');
    if (tables.includes('TaxRates')) await queryInterface.dropTable('TaxRates');
  },
};
