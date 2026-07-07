'use strict';

// Adds: Contacts.status/adSynced/adObjectGUID/adLastSynced (for CSV import +
// AD sync's deactivation flow), AdSyncLogs (sync run history), and
// AdGroupMappings (AD group name -> PRISM department).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const contactCols = await queryInterface.describeTable('Contacts');
    if (!contactCols.status) {
      await queryInterface.addColumn('Contacts', 'status', {
        type: dt.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active',
      });
    }
    if (!contactCols.adSynced) {
      await queryInterface.addColumn('Contacts', 'adSynced', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    }
    if (!contactCols.adObjectGUID) {
      await queryInterface.addColumn('Contacts', 'adObjectGUID', { type: dt.STRING(64), allowNull: true });
      await queryInterface.addIndex('Contacts', ['adObjectGUID']);
    }
    if (!contactCols.adLastSynced) {
      await queryInterface.addColumn('Contacts', 'adLastSynced', { type: dt.DATE, allowNull: true });
    }

    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));

    if (!tableNames.includes('AdSyncLogs')) {
      await queryInterface.createTable('AdSyncLogs', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        startedAt: { type: dt.DATE, allowNull: false },
        completedAt: { type: dt.DATE, allowNull: true },
        status: { type: dt.ENUM('running', 'success', 'failed'), allowNull: false, defaultValue: 'running' },
        usersProcessed: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        contactsCreated: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        contactsUpdated: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        contactsDeactivated: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        errorDetails: { type: dt.JSON, allowNull: true },
        triggeredBy: { type: dt.ENUM('manual', 'scheduled'), allowNull: false, defaultValue: 'scheduled' },
      });
    }

    if (!tableNames.includes('AdGroupMappings')) {
      await queryInterface.createTable('AdGroupMappings', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        adGroupName: { type: dt.STRING(255), allowNull: false },
        departmentId: { type: dt.INTEGER, allowNull: false },
        createdAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
      });
      await queryInterface.addIndex('AdGroupMappings', ['adGroupName']);
    }
  },

  down: async (queryInterface) => {
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('AdGroupMappings')) await queryInterface.dropTable('AdGroupMappings');
    if (tableNames.includes('AdSyncLogs')) await queryInterface.dropTable('AdSyncLogs');

    const contactCols = await queryInterface.describeTable('Contacts');
    if (contactCols.adLastSynced) await queryInterface.removeColumn('Contacts', 'adLastSynced');
    if (contactCols.adObjectGUID) await queryInterface.removeColumn('Contacts', 'adObjectGUID');
    if (contactCols.adSynced) await queryInterface.removeColumn('Contacts', 'adSynced');
    if (contactCols.status) await queryInterface.removeColumn('Contacts', 'status');
  },
};
