'use strict';

/**
 * Adds a `type` column to Comments so the ticket conversation thread can carry
 * three kinds of entries: customer-visible replies, and internal tech
 * comments that are either private (staff-only) or public (visible to the
 * customer too). Existing rows default to 'reply' so history stays intact.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { ENUM } = Sequelize;
    const cols = await queryInterface.describeTable('Comments');
    if (!cols.type) {
      await queryInterface.addColumn('Comments', 'type', {
        type: ENUM('reply', 'comment_private', 'comment_public'),
        allowNull: false,
        defaultValue: 'reply',
      });
    }
    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Comments', 'type');
    return undefined;
  },
};
