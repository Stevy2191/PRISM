'use strict';

// Who a computer's user is, when their sign-in carries no email PRISM can
// match (a Mac or a PC that isn't joined to a directory) (owner,
// 2026-11-13). Staff say it once, by choosing the contact on a ticket that
// person raised from the agent; PRISM remembers "this account on this
// computer is that contact".
//
// Tickets.agentAccount: the computer account that raised an agent ticket.
// AgentUserLinks: one row per computer and account. No foreign keys: the
// agent's tables are dropped and rebuilt by their own migration's round
// trip, and a link to a contact or computer that's gone is simply ignored.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tickets = await queryInterface.describeTable('Tickets');
    if (!tickets.agentAccount) await queryInterface.addColumn('Tickets', 'agentAccount', { type: Sequelize.STRING(255), allowNull: true });
    const exists = await queryInterface.describeTable('AgentUserLinks').then(() => true).catch(() => false);
    if (exists) return;
    await queryInterface.createTable('AgentUserLinks', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      deviceId: { type: Sequelize.INTEGER, allowNull: false },
      account: { type: Sequelize.STRING(255), allowNull: false },
      contactId: { type: Sequelize.INTEGER, allowNull: false },
      // 'staff' (chosen on a ticket) or 'assigned' (the computer's own assignee).
      source: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'staff' },
      createdBy: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('AgentUserLinks', ['deviceId', 'account'], { unique: true, name: 'agent_user_links_device_account' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('AgentUserLinks').catch(() => {});
    const tickets = await queryInterface.describeTable('Tickets');
    if (tickets.agentAccount) await queryInterface.removeColumn('Tickets', 'agentAccount');
  },
};
