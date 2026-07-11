'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (!ticketCols.source) {
      await queryInterface.addColumn('Tickets', 'source', {
        type: dt.ENUM('manual', 'email', 'phone', 'portal'),
        allowNull: false,
        defaultValue: 'manual',
      });
    }

    const tables = await queryInterface.showAllTables();
    if (!tables.includes('EmailProcessingLogs')) {
      await queryInterface.createTable('EmailProcessingLogs', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        messageId: { type: dt.STRING(500), allowNull: true },
        fromEmail: { type: dt.STRING(255), allowNull: true },
        subject: { type: dt.STRING(998), allowNull: true },
        action: { type: dt.ENUM('ticket_created', 'reply_added', 'ignored', 'failed'), allowNull: false },
        ticketId: { type: dt.INTEGER, allowNull: true },
        processedAt: { type: dt.DATE, allowNull: false },
        error: { type: dt.TEXT, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('EmailProcessingLogs')) await queryInterface.dropTable('EmailProcessingLogs');

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (ticketCols.source) await queryInterface.removeColumn('Tickets', 'source');
  },
};
