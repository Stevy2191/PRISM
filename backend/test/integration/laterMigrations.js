const Sequelize = require('sequelize');
const { sequelize } = require('./helpers');

// Round-trip tests roll an old migration back and forward again. A newer
// migration whose tables or columns point at the old one's (069's FKs into
// Tasks, Projects, ...) must be rolled back first and re-applied after, or
// the old down() fails midway and leaves the test DB half rolled back.
// Add newer migrations here, oldest first.
// 071 (workload) is deliberately NOT listed: it only adds standalone columns
// (Users.workHours, Tickets.plannedDate), settings and a permission, with no
// reference into an older migration's tables. Rolling it back mid-test would
// drop Users.workHours, which the User model selects, so every login in the
// older round-trip suites would fail with a 500.
const later = [
  require('../../migrations/20260101000069-project-structure'),
  require('../../migrations/20260101000070-project-templates'),
];

const qi = () => sequelize.getQueryInterface();

async function rollbackLater() {
  for (const m of [...later].reverse()) await m.down(qi(), Sequelize); // eslint-disable-line no-await-in-loop
}
async function reapplyLater() {
  for (const m of later) await m.up(qi(), Sequelize); // eslint-disable-line no-await-in-loop
}

// Wrap a migration so down() first rolls the later ones back and up()
// re-applies them afterwards. The re-apply also runs when the old step
// throws, so a failed step cannot strand the schema.
function aroundLater(migration) {
  return {
    down: async (...args) => {
      await rollbackLater();
      try { await migration.down(...args); } catch (e) { await reapplyLater(); throw e; }
    },
    up: async (...args) => {
      await migration.up(...args);
      await reapplyLater();
    },
  };
}

module.exports = { later, rollbackLater, reapplyLater, aroundLater };
