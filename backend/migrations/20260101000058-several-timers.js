'use strict';

// Several timers per user (user decision 2026-10-12): one per ticket or
// project, so timers on different items count at the same time. Each user
// also gets reminder timing for timers left running: the first reminder after
// timerReminderMinutes of running (0 = off), then every
// timerReminderRepeatMinutes.
const TARGET_INDEX = 'active_timers_user_target';

async function userIdUniqueIndexes(queryInterface) {
  const [rows] = await queryInterface.sequelize.query("SHOW INDEX FROM ActiveTimers WHERE Column_name = 'userId' AND Non_unique = 0");
  const byName = new Map();
  rows.forEach((r) => byName.set(r.Key_name, (byName.get(r.Key_name) || 0) + 1));
  // Only an index on userId alone, not the new (userId, entityType, entityId) one.
  const [all] = await queryInterface.sequelize.query('SHOW INDEX FROM ActiveTimers');
  return [...byName.keys()].filter((name) => all.filter((r) => r.Key_name === name).length === 1);
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // The new index starts with userId, so the foreign key keeps an index
    // when the old one-per-user unique index goes.
    await queryInterface.addIndex('ActiveTimers', ['userId', 'entityType', 'entityId'], { unique: true, name: TARGET_INDEX });
    for (const name of await userIdUniqueIndexes(queryInterface)) {
      await queryInterface.removeIndex('ActiveTimers', name); // eslint-disable-line no-await-in-loop
    }
    await queryInterface.addColumn('Users', 'timerReminderMinutes', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 120 });
    await queryInterface.addColumn('Users', 'timerReminderRepeatMinutes', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 });
  },

  // One timer per user again: each user keeps their most recently started
  // timer; the others are removed without being logged.
  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DELETE t FROM ActiveTimers t
      JOIN ActiveTimers newer ON newer.userId = t.userId
        AND (newer.startedAt > t.startedAt OR (newer.startedAt = t.startedAt AND newer.id > t.id))`);
    await queryInterface.addIndex('ActiveTimers', ['userId'], { unique: true, name: 'userId' });
    await queryInterface.removeIndex('ActiveTimers', TARGET_INDEX);
    await queryInterface.removeColumn('Users', 'timerReminderRepeatMinutes');
    await queryInterface.removeColumn('Users', 'timerReminderMinutes');
  },
};
