'use strict';

/**
 * Separates "does this user have personal colors saved" (userColors, added
 * in the previous migration) from "are they currently active" (this flag).
 * Without this, toggling personal colors off had no way to disable them
 * without destroying the saved values — the toggle and "Reset to system
 * defaults" were indistinguishable. Now toggling off only flips this flag;
 * userColors is left untouched until the user explicitly resets.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('Users');
    if (!cols.userColorsEnabled) {
      await queryInterface.addColumn('Users', 'userColorsEnabled', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'userColorsEnabled');
    return undefined;
  },
};
