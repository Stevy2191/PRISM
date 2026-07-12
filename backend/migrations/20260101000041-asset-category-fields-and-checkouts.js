'use strict';

// Extends the asset tracking module (20260101000039) with: a generic
// per-category custom-field system (mirrors CustomField/TicketFieldValue
// for tickets), checkout/check-in tracking, asset-scoped attachments, two
// new built-in categories, and a deployedDate column.

const NEW_CATEGORIES = [
  { name: 'Laptops', icon: '💻', color: '#0ea5e9' },
  { name: 'Mobile Routers / Hotspots', icon: '📶', color: '#9333ea' },
];

// Built-in fields per category, seeded as isBuiltIn:true rows — viewable and
// extendable (admins can add more fields) but not deletable from the
// Settings -> Asset Categories UI. fieldKey is unique per-category, not
// globally (subscription fields intentionally reuse the same key across
// Network Equipment / Mobile Devices / Mobile Routers so the subscription-
// renewal alert scheduler and dashboard/calendar features can query by a
// single well-known key regardless of category).
const BUILT_IN_FIELDS = {
  'Network Equipment': [
    { fieldKey: 'rackName', label: 'Rack name', fieldType: 'text', position: 1 },
    { fieldKey: 'rackUnitPosition', label: 'Rack unit position', fieldType: 'text', position: 2 },
    { fieldKey: 'port', label: 'Port', fieldType: 'text', position: 3 },
    { fieldKey: 'subscriptionProvider', label: 'Subscription provider', fieldType: 'text', position: 4 },
    { fieldKey: 'subscriptionCost', label: 'Subscription cost', fieldType: 'number', position: 5 },
    { fieldKey: 'billingCycle', label: 'Billing cycle', fieldType: 'dropdown', options: ['Monthly', 'Annual'], position: 6 },
    { fieldKey: 'nextRenewalDate', label: 'Next billing/renewal date', fieldType: 'date', position: 7 },
    { fieldKey: 'autoRenews', label: 'Auto-renews', fieldType: 'toggle', position: 8 },
  ],
  Servers: [
    { fieldKey: 'rackName', label: 'Rack name', fieldType: 'text', position: 1 },
    { fieldKey: 'rackUnit', label: 'Rack unit', fieldType: 'text', position: 2 },
  ],
  Printers: [
    { fieldKey: 'tonerModelNumber', label: 'Toner/ink model number', fieldType: 'text', position: 1 },
  ],
  'Mobile Devices': [
    { fieldKey: 'imei', label: 'IMEI number', fieldType: 'text', position: 1 },
    { fieldKey: 'carrier', label: 'Carrier', fieldType: 'text', position: 2 },
    { fieldKey: 'phoneNumber', label: 'Phone number', fieldType: 'phone', position: 3 },
    { fieldKey: 'subscriptionProvider', label: 'Subscription provider', fieldType: 'text', position: 4 },
    { fieldKey: 'subscriptionCost', label: 'Subscription cost', fieldType: 'number', position: 5 },
    { fieldKey: 'billingCycle', label: 'Billing cycle', fieldType: 'dropdown', options: ['Monthly', 'Annual'], position: 6 },
    { fieldKey: 'nextRenewalDate', label: 'Next renewal date', fieldType: 'date', position: 7 },
    { fieldKey: 'autoRenews', label: 'Auto-renews', fieldType: 'toggle', position: 8 },
  ],
  'Mobile Routers / Hotspots': [
    { fieldKey: 'imei', label: 'IMEI number', fieldType: 'text', position: 1 },
    { fieldKey: 'carrier', label: 'Carrier', fieldType: 'text', position: 2 },
    { fieldKey: 'phoneOrSimNumber', label: 'Phone/SIM number', fieldType: 'phone', position: 3 },
    { fieldKey: 'subscriptionProvider', label: 'Subscription provider', fieldType: 'text', position: 4 },
    { fieldKey: 'subscriptionCost', label: 'Subscription cost', fieldType: 'number', position: 5 },
    { fieldKey: 'billingCycle', label: 'Billing cycle', fieldType: 'dropdown', options: ['Monthly', 'Annual'], position: 6 },
    { fieldKey: 'nextRenewalDate', label: 'Next renewal date', fieldType: 'date', position: 7 },
    { fieldKey: 'autoRenews', label: 'Auto-renews', fieldType: 'toggle', position: 8 },
  ],
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt, QueryTypes } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const tables = await queryInterface.showAllTables();

    // ---- AssetCategories.isBuiltIn + new categories ----
    const catCols = await queryInterface.describeTable('AssetCategories');
    if (!catCols.isBuiltIn) {
      await queryInterface.addColumn('AssetCategories', 'isBuiltIn', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
      await queryInterface.sequelize.query('UPDATE `AssetCategories` SET `isBuiltIn` = true');
    }
    const existingCatNames = (await queryInterface.sequelize.query('SELECT `name` FROM `AssetCategories`', { type: QueryTypes.SELECT })).map((r) => r.name);
    const catsToInsert = NEW_CATEGORIES.filter((c) => !existingCatNames.includes(c.name));
    if (catsToInsert.length) {
      await queryInterface.bulkInsert('AssetCategories', catsToInsert.map((c) => ({ ...c, isBuiltIn: true, createdAt: new Date() })));
    }

    // ---- Assets.deployedDate ----
    const assetCols = await queryInterface.describeTable('Assets');
    if (!assetCols.deployedDate) {
      await queryInterface.addColumn('Assets', 'deployedDate', { type: dt.DATEONLY, allowNull: true });
    }

    // ---- AssetCategoryFields ----
    if (!tables.includes('AssetCategoryFields')) {
      await queryInterface.createTable('AssetCategoryFields', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        categoryId: { type: dt.INTEGER, allowNull: false },
        fieldKey: { type: dt.STRING(100), allowNull: false },
        label: { type: dt.STRING(255), allowNull: false },
        fieldType: { type: dt.ENUM('text', 'number', 'date', 'dropdown', 'toggle', 'phone', 'email'), allowNull: false, defaultValue: 'text' },
        options: { type: dt.JSON, allowNull: true },
        required: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        isBuiltIn: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('AssetCategoryFields', ['categoryId']);
      await queryInterface.addIndex('AssetCategoryFields', ['categoryId', 'fieldKey'], { unique: true, name: 'asset_category_fields_category_key_unique' });
    }

    // ---- AssetFieldValues ----
    if (!tables.includes('AssetFieldValues')) {
      await queryInterface.createTable('AssetFieldValues', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: { type: dt.INTEGER, allowNull: false },
        fieldId: { type: dt.INTEGER, allowNull: false },
        value: { type: dt.TEXT, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('AssetFieldValues', ['assetId', 'fieldId'], { unique: true, name: 'asset_field_values_asset_field_unique' });
    }

    // ---- AssetCheckouts ----
    if (!tables.includes('AssetCheckouts')) {
      await queryInterface.createTable('AssetCheckouts', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: { type: dt.INTEGER, allowNull: false },
        contactId: { type: dt.INTEGER, allowNull: false },
        checkedOutBy: { type: dt.INTEGER, allowNull: true },
        checkedOutAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        checkedInAt: { type: dt.DATE, allowNull: true },
        checkedInBy: { type: dt.INTEGER, allowNull: true },
        checkoutFormSentAt: { type: dt.DATE, allowNull: true },
        checkoutFormReturnedAt: { type: dt.DATE, allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('AssetCheckouts', ['assetId']);
    }

    // ---- AssetAttachments ----
    if (!tables.includes('AssetAttachments')) {
      await queryInterface.createTable('AssetAttachments', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: { type: dt.INTEGER, allowNull: false },
        filename: { type: dt.STRING(255), allowNull: false },
        originalName: { type: dt.STRING(255), allowNull: false },
        mimeType: { type: dt.STRING(100), allowNull: true },
        size: { type: dt.INTEGER, allowNull: true },
        uploadedById: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('AssetAttachments', ['assetId']);
    }

    // ---- Seed built-in category fields ----
    const catRows = await queryInterface.sequelize.query('SELECT `id`, `name` FROM `AssetCategories`', { type: QueryTypes.SELECT });
    const catIdByName = new Map(catRows.map((r) => [r.name, r.id]));
    const existingFieldRows = await queryInterface.sequelize.query('SELECT `categoryId`, `fieldKey` FROM `AssetCategoryFields`', { type: QueryTypes.SELECT });
    const existingFieldSet = new Set(existingFieldRows.map((r) => `${r.categoryId}:${r.fieldKey}`));

    const fieldRowsToInsert = [];
    for (const [catName, fields] of Object.entries(BUILT_IN_FIELDS)) {
      const categoryId = catIdByName.get(catName);
      if (!categoryId) continue; // eslint-disable-line no-continue
      for (const f of fields) {
        if (existingFieldSet.has(`${categoryId}:${f.fieldKey}`)) continue; // eslint-disable-line no-continue
        fieldRowsToInsert.push({
          categoryId,
          fieldKey: f.fieldKey,
          label: f.label,
          fieldType: f.fieldType,
          options: f.options ? JSON.stringify(f.options) : null,
          required: false,
          isBuiltIn: true,
          position: f.position,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
    if (fieldRowsToInsert.length) {
      await queryInterface.bulkInsert('AssetCategoryFields', fieldRowsToInsert);
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('AssetAttachments')) await queryInterface.dropTable('AssetAttachments');
    if (tables.includes('AssetCheckouts')) await queryInterface.dropTable('AssetCheckouts');
    if (tables.includes('AssetFieldValues')) await queryInterface.dropTable('AssetFieldValues');
    if (tables.includes('AssetCategoryFields')) await queryInterface.dropTable('AssetCategoryFields');

    const assetCols = await queryInterface.describeTable('Assets');
    if (assetCols.deployedDate) await queryInterface.removeColumn('Assets', 'deployedDate');

    await queryInterface.bulkDelete('AssetCategories', { name: NEW_CATEGORIES.map((c) => c.name) });

    const catCols = await queryInterface.describeTable('AssetCategories');
    if (catCols.isBuiltIn) await queryInterface.removeColumn('AssetCategories', 'isBuiltIn');
  },
};
