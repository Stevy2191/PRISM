'use strict';

/**
 * Two independent additions bundled in one migration for this task:
 *   1. TimeEntries gain startTime/endTime (DATETIME, nullable — only set for
 *      entries created via the new start/end picker; existing duration-only
 *      rows are left null and keep displaying from `minutes`) and
 *      durationSeconds (precise duration, backfilled from minutes for old rows).
 *   2. Tickets gain a customer-visible resolution field plus who/when it was
 *      last updated.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DATE, INTEGER, TEXT } = Sequelize;

    const timeEntryCols = await queryInterface.describeTable('TimeEntries');
    if (!timeEntryCols.startTime) {
      await queryInterface.addColumn('TimeEntries', 'startTime', { type: DATE, allowNull: true });
    }
    if (!timeEntryCols.endTime) {
      await queryInterface.addColumn('TimeEntries', 'endTime', { type: DATE, allowNull: true });
    }
    if (!timeEntryCols.durationSeconds) {
      await queryInterface.addColumn('TimeEntries', 'durationSeconds', { type: INTEGER, allowNull: true });
      await queryInterface.sequelize.query('UPDATE TimeEntries SET durationSeconds = minutes * 60 WHERE durationSeconds IS NULL');
    }

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (!ticketCols.resolution) {
      await queryInterface.addColumn('Tickets', 'resolution', { type: TEXT, allowNull: true });
    }
    if (!ticketCols.resolutionUpdatedBy) {
      await queryInterface.addColumn('Tickets', 'resolutionUpdatedBy', {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
    if (!ticketCols.resolutionUpdatedAt) {
      await queryInterface.addColumn('Tickets', 'resolutionUpdatedAt', { type: DATE, allowNull: true });
    }

    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Tickets', 'resolutionUpdatedAt');
    await queryInterface.removeColumn('Tickets', 'resolutionUpdatedBy');
    await queryInterface.removeColumn('Tickets', 'resolution');
    await queryInterface.removeColumn('TimeEntries', 'durationSeconds');
    await queryInterface.removeColumn('TimeEntries', 'endTime');
    await queryInterface.removeColumn('TimeEntries', 'startTime');
    return undefined;
  },
};
