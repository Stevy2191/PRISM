'use strict';

// A user's own screen choices that follow their account, not the browser
// (owner, 2026-11-13): first, which columns the Tickets list shows. One row
// per user and key; the value belongs to the screen that saves it.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const exists = await queryInterface.describeTable('UserPreferences').then(() => true).catch(() => false);
    if (exists) return;
    await queryInterface.createTable('UserPreferences', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: {
        type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE',
      },
      key: { type: Sequelize.STRING(64), allowNull: false },
      value: { type: Sequelize.JSON, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('UserPreferences', ['userId', 'key'], { unique: true, name: 'user_preferences_user_key' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('UserPreferences').catch(() => {});
  },
};
