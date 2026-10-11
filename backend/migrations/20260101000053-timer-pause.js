'use strict';

// The server timer pauses and resumes (plan 3c; user decision 2026-10-11):
// accumulatedSeconds holds finished running stretches, runningSince the start
// of the current one (null while paused). A running timer from before this
// is one stretch that began at startedAt.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('ActiveTimers', 'accumulatedSeconds', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('ActiveTimers', 'runningSince', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.sequelize.query('UPDATE ActiveTimers SET runningSince = startedAt');
  },
  down: async (queryInterface) => {
    // A paused timer can't be expressed without these columns: fold it back
    // into a running one that started its elapsed time ago.
    await queryInterface.sequelize.query(
      'UPDATE ActiveTimers SET startedAt = DATE_SUB(COALESCE(runningSince, NOW()), INTERVAL accumulatedSeconds SECOND)'
    );
    await queryInterface.removeColumn('ActiveTimers', 'runningSince');
    await queryInterface.removeColumn('ActiveTimers', 'accumulatedSeconds');
  },
};
