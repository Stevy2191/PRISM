'use strict';

// Licenses & Contracts module — software license and vendor contract
// tracking under the Assets section. Mirrors the Asset module's shape
// (a parent record + join tables for links + a per-parent attachment
// table + a per-parent activity log), see 20260101000039-asset-tracking.js
// and 20260101000041-asset-category-fields-and-checkouts.js for the
// conventions this follows: no DB-level FK constraints (plain INTEGER FK
// columns + Sequelize associations), idempotent createTable guards.
//
// LicenseTickets/ContractTickets exist purely so the alert scheduler can
// trace an auto-created renewal/expiry ticket back to its license/contract
// and check whether that ticket is still open before creating a duplicate
// (see licenseContractAlertScheduler.js) — there's no UI "Tickets" tab for
// either module per the spec, this is scheduler plumbing only.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const tables = await queryInterface.showAllTables();

    // ---- Licenses ----
    if (!tables.includes('Licenses')) {
      await queryInterface.createTable('Licenses', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(255), allowNull: false },
        vendor: { type: dt.STRING(150), allowNull: true },
        licenseType: { type: dt.ENUM('per_seat', 'per_device', 'site_license', 'concurrent', 'subscription'), allowNull: false, defaultValue: 'per_seat' },
        totalSeats: { type: dt.INTEGER, allowNull: true },
        usedSeats: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        // AES-256-GCM ciphertext (see utils/tokenCrypto.js) — never stored or
        // returned in plaintext; API responses mask it unless the caller has
        // assets.view_license_keys and explicitly requests a reveal.
        licenseKey: { type: dt.TEXT, allowNull: true },
        purchaseDate: { type: dt.DATEONLY, allowNull: true },
        expiryDate: { type: dt.DATEONLY, allowNull: true },
        renewalDate: { type: dt.DATEONLY, allowNull: true },
        annualCost: { type: dt.DECIMAL(10, 2), allowNull: true },
        autoRenews: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        departmentId: { type: dt.INTEGER, allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('Licenses', ['departmentId']);
      await queryInterface.addIndex('Licenses', ['expiryDate']);
      await queryInterface.addIndex('Licenses', ['renewalDate']);
      await queryInterface.addIndex('Licenses', ['licenseType']);
    }

    if (!tables.includes('LicenseAssets')) {
      await queryInterface.createTable('LicenseAssets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        licenseId: { type: dt.INTEGER, allowNull: false },
        assetId: { type: dt.INTEGER, allowNull: false },
        assignedAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        assignedBy: { type: dt.INTEGER, allowNull: true },
      });
      await queryInterface.addIndex('LicenseAssets', ['licenseId']);
      await queryInterface.addIndex('LicenseAssets', ['assetId']);
      await queryInterface.addIndex('LicenseAssets', ['licenseId', 'assetId'], { unique: true, name: 'license_assets_license_asset_unique' });
    }

    if (!tables.includes('LicenseContacts')) {
      await queryInterface.createTable('LicenseContacts', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        licenseId: { type: dt.INTEGER, allowNull: false },
        contactId: { type: dt.INTEGER, allowNull: false },
        assignedAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        assignedBy: { type: dt.INTEGER, allowNull: true },
      });
      await queryInterface.addIndex('LicenseContacts', ['licenseId']);
      await queryInterface.addIndex('LicenseContacts', ['contactId']);
      await queryInterface.addIndex('LicenseContacts', ['licenseId', 'contactId'], { unique: true, name: 'license_contacts_license_contact_unique' });
    }

    if (!tables.includes('LicenseAttachments')) {
      await queryInterface.createTable('LicenseAttachments', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        licenseId: { type: dt.INTEGER, allowNull: false },
        filename: { type: dt.STRING(255), allowNull: false },
        originalName: { type: dt.STRING(255), allowNull: false },
        mimeType: { type: dt.STRING(100), allowNull: true },
        size: { type: dt.INTEGER, allowNull: true },
        uploadedById: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('LicenseAttachments', ['licenseId']);
    }

    if (!tables.includes('LicenseActivity')) {
      await queryInterface.createTable('LicenseActivity', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        licenseId: { type: dt.INTEGER, allowNull: false },
        userId: { type: dt.INTEGER, allowNull: true },
        action: { type: dt.STRING(50), allowNull: false },
        detail: { type: dt.JSON, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('LicenseActivity', ['licenseId']);
    }

    if (!tables.includes('LicenseTickets')) {
      await queryInterface.createTable('LicenseTickets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        licenseId: { type: dt.INTEGER, allowNull: false },
        ticketId: { type: dt.INTEGER, allowNull: false },
        linkedAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        linkedBy: { type: dt.INTEGER, allowNull: true },
      });
      await queryInterface.addIndex('LicenseTickets', ['licenseId']);
      await queryInterface.addIndex('LicenseTickets', ['ticketId']);
    }

    // ---- Contracts ----
    if (!tables.includes('Contracts')) {
      await queryInterface.createTable('Contracts', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(255), allowNull: false },
        vendor: { type: dt.STRING(150), allowNull: true },
        contractType: { type: dt.ENUM('support', 'maintenance', 'saas', 'lease', 'subscription', 'warranty', 'other'), allowNull: false, defaultValue: 'support' },
        startDate: { type: dt.DATEONLY, allowNull: true },
        endDate: { type: dt.DATEONLY, allowNull: true },
        renewalDate: { type: dt.DATEONLY, allowNull: true },
        autoRenews: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        annualCost: { type: dt.DECIMAL(10, 2), allowNull: true },
        totalValue: { type: dt.DECIMAL(10, 2), allowNull: true },
        contactPerson: { type: dt.STRING(150), allowNull: true },
        contactEmail: { type: dt.STRING(150), allowNull: true },
        contactPhone: { type: dt.STRING(20), allowNull: true },
        departmentId: { type: dt.INTEGER, allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('Contracts', ['departmentId']);
      await queryInterface.addIndex('Contracts', ['endDate']);
      await queryInterface.addIndex('Contracts', ['renewalDate']);
      await queryInterface.addIndex('Contracts', ['contractType']);
    }

    if (!tables.includes('ContractAssets')) {
      await queryInterface.createTable('ContractAssets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        contractId: { type: dt.INTEGER, allowNull: false },
        assetId: { type: dt.INTEGER, allowNull: false },
        linkedAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        linkedBy: { type: dt.INTEGER, allowNull: true },
      });
      await queryInterface.addIndex('ContractAssets', ['contractId']);
      await queryInterface.addIndex('ContractAssets', ['assetId']);
      await queryInterface.addIndex('ContractAssets', ['contractId', 'assetId'], { unique: true, name: 'contract_assets_contract_asset_unique' });
    }

    if (!tables.includes('ContractAttachments')) {
      await queryInterface.createTable('ContractAttachments', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        contractId: { type: dt.INTEGER, allowNull: false },
        filename: { type: dt.STRING(255), allowNull: false },
        originalName: { type: dt.STRING(255), allowNull: false },
        mimeType: { type: dt.STRING(100), allowNull: true },
        size: { type: dt.INTEGER, allowNull: true },
        uploadedById: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('ContractAttachments', ['contractId']);
    }

    if (!tables.includes('ContractActivity')) {
      await queryInterface.createTable('ContractActivity', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        contractId: { type: dt.INTEGER, allowNull: false },
        userId: { type: dt.INTEGER, allowNull: true },
        action: { type: dt.STRING(50), allowNull: false },
        detail: { type: dt.JSON, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('ContractActivity', ['contractId']);
    }

    if (!tables.includes('ContractTickets')) {
      await queryInterface.createTable('ContractTickets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        contractId: { type: dt.INTEGER, allowNull: false },
        ticketId: { type: dt.INTEGER, allowNull: false },
        linkedAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        linkedBy: { type: dt.INTEGER, allowNull: true },
      });
      await queryInterface.addIndex('ContractTickets', ['contractId']);
      await queryInterface.addIndex('ContractTickets', ['ticketId']);
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    const drop = async (name) => { if (tables.includes(name)) await queryInterface.dropTable(name); };
    await drop('ContractTickets');
    await drop('ContractActivity');
    await drop('ContractAttachments');
    await drop('ContractAssets');
    await drop('Contracts');
    await drop('LicenseTickets');
    await drop('LicenseActivity');
    await drop('LicenseAttachments');
    await drop('LicenseContacts');
    await drop('LicenseAssets');
    await drop('Licenses');
  },
};
