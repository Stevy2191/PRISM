'use strict';

// Agreements (Phase 3, step 3): what a recurring customer pays each month,
// billed in advance on the 1st. Lines are priced per user (by support tier),
// per device (by asset category), per license (the count read from the
// customer's Microsoft 365 tenant, or typed), flat, or as a prepaid block of
// hours with an overage rate.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const names = await tableNames(qi);
    const fk = (model, onDelete = 'SET NULL') => ({ type: dt.INTEGER, allowNull: true, references: { model, key: 'id' }, onDelete });
    if (!names.includes('Agreements')) {
      await qi.createTable('Agreements', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: { type: dt.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'RESTRICT' },
        name: { type: dt.STRING(200), allowNull: false },
        slaPolicyId: fk('SlaPolicies'),
        startsOn: { type: dt.DATEONLY, allowNull: false },
        endsOn: { type: dt.DATEONLY, allowNull: true },
        status: { type: dt.ENUM('active', 'cancelled'), allowNull: false, defaultValue: 'active' },
        cancelledOn: { type: dt.DATEONLY, allowNull: true },
        termsDays: { type: dt.INTEGER, allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdBy: fk('Users'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('Agreements', ['companyId', 'status'], { name: 'agreements_company_status' });
    }
    if (!names.includes('AgreementLines')) {
      await qi.createTable('AgreementLines', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        agreementId: { type: dt.INTEGER, allowNull: false, references: { model: 'Agreements', key: 'id' }, onDelete: 'CASCADE' },
        kind: { type: dt.ENUM('flat', 'per_user', 'per_device', 'license', 'prepaid_hours'), allowNull: false },
        description: { type: dt.STRING(500), allowNull: false },
        unitPrice: { type: dt.DECIMAL(12, 4), allowNull: false },
        tier: { type: dt.ENUM('full', 'light'), allowNull: true },
        assetCategoryId: fk('AssetCategories'),
        catalogProductId: fk('CatalogProducts'),
        skuId: { type: dt.STRING(64), allowNull: true },
        countSource: { type: dt.ENUM('m365', 'manual'), allowNull: true },
        manualCount: { type: dt.DECIMAL(12, 4), allowNull: true },
        hours: { type: dt.DECIMAL(8, 2), allowNull: true },
        rollover: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        overageRate: { type: dt.DECIMAL(12, 2), allowNull: true },
        hoursBalanceMinutes: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        lastBilledQuantity: { type: dt.DECIMAL(12, 4), allowNull: true },
        taxCategoryId: fk('TaxCategories'),
        sortOrder: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
  },

  down: async (queryInterface) => {
    const names = await tableNames(queryInterface);
    if (names.includes('AgreementLines')) await queryInterface.dropTable('AgreementLines');
    if (names.includes('Agreements')) await queryInterface.dropTable('Agreements');
  },
};
