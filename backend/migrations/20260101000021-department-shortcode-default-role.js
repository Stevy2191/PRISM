'use strict';

/**
 * Adds fields needed by the Departments admin page (Prompt 3 of the
 * roles/permissions build): a short code used in project IDs, and a default
 * role auto-assigned to new users added to the department. Soft reference to
 * Roles (no FK constraint), matching this codebase's established convention
 * for post-init-schema migrations.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('Departments');
    if (!cols.shortCode) {
      await queryInterface.addColumn('Departments', 'shortCode', { type: Sequelize.STRING(10), allowNull: true });
    }
    if (!cols.defaultRoleId) {
      await queryInterface.addColumn('Departments', 'defaultRoleId', { type: Sequelize.INTEGER, allowNull: true });
      await queryInterface.addIndex('Departments', ['defaultRoleId']);
    }
    return undefined;
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const cols = await queryInterface.describeTable('Departments');
    if (cols.defaultRoleId) await q('ALTER TABLE `Departments` DROP COLUMN `defaultRoleId`');
    if (cols.shortCode) await q('ALTER TABLE `Departments` DROP COLUMN `shortCode`');
    return undefined;
  },
};
