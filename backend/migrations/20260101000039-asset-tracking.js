'use strict';

// Asset tracking core module: categories, assets, ticket links, and an
// activity log — mirrors the shape of the ticket/project activity logs
// already in this app (see TicketActivity/ProjectActivity).

const CATEGORIES = [
  { name: 'Computers', icon: '💻', color: '#2563eb' },
  { name: 'Network Equipment', icon: '🌐', color: '#7c3aed' },
  { name: 'Servers', icon: '🖥️', color: '#0891b2' },
  { name: 'Printers', icon: '🖨️', color: '#16a34a' },
  { name: 'Mobile Devices', icon: '📱', color: '#d97706' },
  { name: 'Other', icon: '📦', color: '#64748b' },
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const tables = await queryInterface.showAllTables();

    if (!tables.includes('AssetCategories')) {
      await queryInterface.createTable('AssetCategories', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(100), allowNull: false, unique: true },
        icon: { type: dt.STRING(20), allowNull: true },
        color: { type: dt.STRING(20), allowNull: true },
        createdAt: now,
      });
      await queryInterface.bulkInsert('AssetCategories', CATEGORIES.map((c) => ({ ...c, createdAt: new Date() })));
    }

    if (!tables.includes('Assets')) {
      await queryInterface.createTable('Assets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetTag: { type: dt.STRING(50), allowNull: false, unique: true },
        name: { type: dt.STRING(255), allowNull: false },
        categoryId: { type: dt.INTEGER, allowNull: false },
        make: { type: dt.STRING(100), allowNull: true },
        model: { type: dt.STRING(100), allowNull: true },
        serialNumber: { type: dt.STRING(150), allowNull: true },
        departmentId: { type: dt.INTEGER, allowNull: true },
        assignedToContactId: { type: dt.INTEGER, allowNull: true },
        assignedToUserId: { type: dt.INTEGER, allowNull: true },
        locationBuilding: { type: dt.STRING(150), allowNull: true },
        locationFloor: { type: dt.STRING(50), allowNull: true },
        locationRoom: { type: dt.STRING(50), allowNull: true },
        status: { type: dt.ENUM('active', 'in_repair', 'retired', 'in_storage', 'lost'), allowNull: false, defaultValue: 'active' },
        purchaseDate: { type: dt.DATEONLY, allowNull: true },
        purchasePrice: { type: dt.DECIMAL(10, 2), allowNull: true },
        vendorName: { type: dt.STRING(150), allowNull: true },
        warrantyExpiryDate: { type: dt.DATEONLY, allowNull: true },
        replacementPlanDate: { type: dt.DATEONLY, allowNull: true },
        ipAddress: { type: dt.STRING(45), allowNull: true },
        macAddress: { type: dt.STRING(50), allowNull: true },
        operatingSystem: { type: dt.STRING(100), allowNull: true },
        osVersion: { type: dt.STRING(50), allowNull: true },
        processor: { type: dt.STRING(150), allowNull: true },
        ram: { type: dt.STRING(50), allowNull: true },
        storage: { type: dt.STRING(50), allowNull: true },
        firmwareVersion: { type: dt.STRING(50), allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('Assets', ['categoryId']);
      await queryInterface.addIndex('Assets', ['departmentId']);
      await queryInterface.addIndex('Assets', ['assignedToContactId']);
      await queryInterface.addIndex('Assets', ['assignedToUserId']);
      await queryInterface.addIndex('Assets', ['status']);
    }

    if (!tables.includes('AssetTickets')) {
      await queryInterface.createTable('AssetTickets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: { type: dt.INTEGER, allowNull: false },
        ticketId: { type: dt.INTEGER, allowNull: false },
        linkedAt: { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        linkedBy: { type: dt.INTEGER, allowNull: true },
      });
      await queryInterface.addIndex('AssetTickets', ['assetId']);
      await queryInterface.addIndex('AssetTickets', ['ticketId']);
      await queryInterface.addIndex('AssetTickets', ['assetId', 'ticketId'], { unique: true, name: 'asset_tickets_asset_ticket_unique' });
    }

    if (!tables.includes('AssetActivity')) {
      await queryInterface.createTable('AssetActivity', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: { type: dt.INTEGER, allowNull: false },
        userId: { type: dt.INTEGER, allowNull: true },
        action: { type: dt.STRING(50), allowNull: false },
        detail: { type: dt.JSON, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('AssetActivity', ['assetId']);
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('AssetActivity')) await queryInterface.dropTable('AssetActivity');
    if (tables.includes('AssetTickets')) await queryInterface.dropTable('AssetTickets');
    if (tables.includes('Assets')) await queryInterface.dropTable('Assets');
    if (tables.includes('AssetCategories')) await queryInterface.dropTable('AssetCategories');
  },
};
