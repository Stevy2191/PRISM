'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const tables = await queryInterface.showAllTables();
    if (!tables.includes('CsatSurveys')) {
      await queryInterface.createTable('CsatSurveys', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: { type: dt.INTEGER, allowNull: false },
        contactId: { type: dt.INTEGER, allowNull: false },
        assignedToUserId: { type: dt.INTEGER, allowNull: true },
        surveyToken: { type: dt.STRING(36), allowNull: false, unique: true },
        status: { type: dt.ENUM('pending', 'responded', 'expired'), allowNull: false, defaultValue: 'pending' },
        dueToSendAt: { type: dt.DATE, allowNull: false },
        sentAt: { type: dt.DATE, allowNull: true },
        respondedAt: { type: dt.DATE, allowNull: true },
        rating: { type: dt.INTEGER, allowNull: true },
        comment: { type: dt.TEXT, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await queryInterface.addIndex('CsatSurveys', ['ticketId']);
      await queryInterface.addIndex('CsatSurveys', ['assignedToUserId']);
      await queryInterface.addIndex('CsatSurveys', ['status']);
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('CsatSurveys')) await queryInterface.dropTable('CsatSurveys');
  },
};
