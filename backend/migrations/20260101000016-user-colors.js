'use strict';

/**
 * Personal color overrides (tier 1 of the color system, above the admin
 * palette and built-in theme defaults). Stores only the CSS variables the
 * user has explicitly overridden, e.g. { "--color-accent": "#e11d48" } —
 * null/absent means the user has no personal overrides.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('Users');
    if (!cols.userColors) {
      await queryInterface.addColumn('Users', 'userColors', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }
    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'userColors');
    return undefined;
  },
};
