'use strict';

// Time waiting on the customer (user decisions 2026-10-15). Each ticket
// status gets a "counts as waiting on the customer" switch, on for the
// automatic Waiting on User status only. The figure is read from the status
// activity log, which stores status names, so the names migration 064
// retired (In Progress → Open, Pending → On Hold, Resolved → Request
// completed) are carried over to the log as well — unless a status by the
// old name exists today, in which case the log rows may be about it.
//
// down() drops the switch only: the log keeps the new names.

const RETIRED = [['In Progress', 'Open'], ['Pending', 'On Hold'], ['Resolved', 'Request completed']];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const cols = await qi.describeTable('TicketStatuses');
    if (!cols.countsAsWaiting) {
      await qi.addColumn('TicketStatuses', 'countsAsWaiting', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }
    await qi.sequelize.transaction(async (t) => {
      await qi.sequelize.query("UPDATE TicketStatuses SET countsAsWaiting = 1 WHERE systemKey = 'waiting_on_user'", { transaction: t });
      const rows = await qi.sequelize.query('SELECT name FROM TicketStatuses', { type: Sequelize.QueryTypes.SELECT, transaction: t });
      const names = new Set(rows.map((r) => r.name));
      // eslint-disable-next-line no-restricted-syntax
      for (const [from, to] of RETIRED) {
        if (names.has(from)) continue; // eslint-disable-line no-continue
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query("UPDATE TicketActivities SET fromValue = ? WHERE action = 'status' AND fromValue = ?", { replacements: [to, from], transaction: t });
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query("UPDATE TicketActivities SET toValue = ? WHERE action = 'status' AND toValue = ?", { replacements: [to, from], transaction: t });
      }
    });
  },

  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('TicketStatuses');
    if (cols.countsAsWaiting) await queryInterface.removeColumn('TicketStatuses', 'countsAsWaiting');
  },
};
