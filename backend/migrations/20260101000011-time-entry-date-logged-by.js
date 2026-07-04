'use strict';

/**
 * Ticket time entries gain:
 *   1. entryDate — the date the work was actually done (DATE only), separate
 *      from loggedAt (the timestamp of when the record was created).
 *   2. loggedById — who actually created the record. Usually equal to
 *      userId, but admins/team leads can log time attributed to another
 *      tech, in which case loggedById (creator) differs from userId
 *      (who the time is attributed to).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DATEONLY, INTEGER } = Sequelize;
    const cols = await queryInterface.describeTable('TimeEntries');

    if (!cols.entryDate) {
      await queryInterface.addColumn('TimeEntries', 'entryDate', { type: DATEONLY, allowNull: true });
      await queryInterface.sequelize.query('UPDATE TimeEntries SET entryDate = DATE(loggedAt) WHERE entryDate IS NULL');
      await queryInterface.changeColumn('TimeEntries', 'entryDate', { type: DATEONLY, allowNull: false });
    }

    if (!cols.loggedById) {
      await queryInterface.addColumn('TimeEntries', 'loggedById', {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
      await queryInterface.sequelize.query('UPDATE TimeEntries SET loggedById = userId WHERE loggedById IS NULL');
    }

    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('TimeEntries', 'loggedById');
    await queryInterface.removeColumn('TimeEntries', 'entryDate');
    return undefined;
  },
};
