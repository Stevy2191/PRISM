'use strict';

// Help-desk notices shown in the PRISM agent (owner, 2026-11-13): a short
// headline and message for one company's computers, or every company's
// (companyId null), until it expires or is taken down.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const exists = await queryInterface.describeTable('AgentNotices').then(() => true).catch(() => false);
    if (exists) return;
    await queryInterface.createTable('AgentNotices', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: {
        type: Sequelize.INTEGER, allowNull: true, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE',
      },
      headline: { type: Sequelize.STRING(120), allowNull: false },
      message: { type: Sequelize.STRING(500), allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      removedAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('AgentNotices', ['companyId', 'removedAt'], { name: 'agent_notices_company' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('AgentNotices').catch(() => {});
  },
};
