'use strict';

/**
 * Removes the custom color system entirely — admin palette, personal color
 * overrides, and preset themes. Only the built-in Light/Dark/System themes
 * (CSS-variable based, see frontend/src/index.css) and branding settings
 * (app name, company name, login tagline/bullets, favicon, logo) remain.
 */
const THEME_KEYS = [
  'theme.mode',
  'theme.preset',
  'theme.bg',
  'theme.sidebar',
  'theme.card',
  'theme.border',
  'theme.accent',
  'theme.accentHover',
  'theme.textPrimary',
  'theme.textSecondary',
  'theme.textMuted',
  'theme.success',
  'theme.warning',
  'theme.danger',
  'theme.timer',
  'theme.usersCanOverrideColors',
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE FROM `SystemSettings` WHERE `key` IN (?)',
      { replacements: [THEME_KEYS] }
    );

    // queryInterface.removeColumn() triggers a formatResults bug in this
    // Sequelize/mariadb-driver combo (DDL result comes back array-shaped,
    // and Sequelize unconditionally tries `delete result.meta` on it) — it
    // was never hit before because every prior use of removeColumn() in
    // this codebase was in a down() path, which normal forward migration
    // never runs. Raw DDL sidesteps that result-formatting path entirely.
    const cols = await queryInterface.describeTable('Users');
    if (cols.userColorsEnabled) {
      await queryInterface.sequelize.query('ALTER TABLE `Users` DROP COLUMN `userColorsEnabled`');
    }
    if (cols.userColors) {
      await queryInterface.sequelize.query('ALTER TABLE `Users` DROP COLUMN `userColors`');
    }
    return undefined;
  },

  async down(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('Users');
    if (!cols.userColors) {
      await queryInterface.addColumn('Users', 'userColors', { type: Sequelize.JSON, allowNull: true });
    }
    if (!cols.userColorsEnabled) {
      await queryInterface.addColumn('Users', 'userColorsEnabled', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    return undefined;
  },
};
