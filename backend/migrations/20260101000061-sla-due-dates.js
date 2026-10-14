'use strict';

// SLA due dates (spec 2026-10-13 change). Targets become per ticket type ×
// priority, each with a unit (minutes or business days); the resolution
// target fixes the ticket's due date at creation and nothing pauses it, so
// TicketStatuses.pausesSla goes; every due date move is kept in
// TicketDueDateChanges; moving one earlier or without a reason needs the
// new tickets.adjust_sla_due permission (System Administrator by default).
const TYPES = ['incident', 'request', 'problem', 'change', 'task'];
const UNITS = ['minutes', 'business_days'];
const CLOCKS = ['assign', 'response', 'resolution'];
const PERMISSION = {
  key: 'tickets.adjust_sla_due',
  category: 'tickets',
  label: 'Adjust SLA due dates',
  description: "Move a ticket's SLA due date earlier, or without a reason",
};
const OLD_INDEX = 'sla_targets_policy_priority';
const NEW_INDEX = 'sla_targets_policy_type_priority';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    // Targets: existing rows become Incident; the other types get copies.
    await qi.addColumn('SlaTargets', 'ticketType', { type: dt.ENUM(...TYPES), allowNull: false, defaultValue: 'incident' });
    for (const c of CLOCKS) {
      // eslint-disable-next-line no-await-in-loop
      await qi.addColumn('SlaTargets', `${c}Unit`, { type: dt.ENUM(...UNITS), allowNull: false, defaultValue: 'minutes' });
    }
    // Swap the unique index first (the new one starts with slaPolicyId, so
    // the foreign key keeps an index), then the copies fit.
    await qi.addIndex('SlaTargets', ['slaPolicyId', 'ticketType', 'priority'], { unique: true, name: NEW_INDEX });
    await qi.removeIndex('SlaTargets', OLD_INDEX);
    const rows = await select('SELECT * FROM SlaTargets');
    const now = new Date();
    const copies = [];
    rows.forEach((r) => TYPES.filter((t) => t !== 'incident').forEach((ticketType) => {
      const { id, ...rest } = r;
      copies.push({ ...rest, ticketType, createdAt: now, updatedAt: now });
    }));
    if (copies.length) await qi.bulkInsert('SlaTargets', copies);

    await qi.addColumn('TicketSlas', 'resolutionOriginalDueAt', { type: dt.DATE, allowNull: true });
    await qi.sequelize.query('UPDATE TicketSlas SET resolutionOriginalDueAt = resolutionDueAt');
    // The ticket type the targets were read for, next to `priority`.
    await qi.addColumn('TicketSlas', 'ticketType', { type: dt.ENUM(...TYPES), allowNull: false, defaultValue: 'incident' });
    await qi.sequelize.query(`UPDATE TicketSlas s JOIN Tickets t ON t.id = s.ticketId
      SET s.ticketType = t.type WHERE t.type IN (${TYPES.map((v) => `'${v}'`).join(',')})`);

    // Open tickets the first SLA build had paused: nothing pauses now, so
    // their resolution clock runs from now with the minutes they had left
    // (wall-clock here; the app re-times on the ticket's next change).
    await qi.sequelize.query(`UPDATE TicketSlas s
      JOIN Tickets t ON t.id = s.ticketId
      JOIN TicketStatuses st ON st.name = t.status
      JOIN SlaPolicies p ON p.id = s.slaPolicyId
      SET s.resolutionRunningSince = NOW(),
          s.resolutionDueAt = NOW() + INTERVAL GREATEST(0, s.resolutionTargetMinutes - s.resolutionUsedMinutes) MINUTE,
          s.resolutionWarnAt = NOW() + INTERVAL GREATEST(0, CEIL(s.resolutionTargetMinutes * p.warnAtPercent / 100) - s.resolutionUsedMinutes) MINUTE,
          s.resolutionOriginalDueAt = NOW() + INTERVAL GREATEST(0, s.resolutionTargetMinutes - s.resolutionUsedMinutes) MINUTE
      WHERE s.resolutionTargetMinutes IS NOT NULL AND s.resolutionRunningSince IS NULL
        AND s.resolutionMetAt IS NULL AND s.resolutionDueAt IS NULL AND st.behaviorType = 'open'`);
    await qi.removeColumn('TicketStatuses', 'pausesSla');

    await qi.createTable('TicketDueDateChanges', {
      id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: {
        type: dt.INTEGER, allowNull: false, references: { model: 'Tickets', key: 'id' }, onDelete: 'CASCADE',
      },
      userId: {
        type: dt.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
      },
      fromDueAt: { type: dt.DATE, allowNull: true },
      toDueAt: { type: dt.DATE, allowNull: false },
      reason: { type: dt.TEXT, allowNull: true },
      kind: { type: dt.ENUM('extension', 'adjustment'), allowNull: false },
      createdAt: { type: dt.DATE, allowNull: false },
    });
    await qi.addIndex('TicketDueDateChanges', ['ticketId'], { name: 'ticket_due_date_changes_ticket' });

    const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (!existing) await qi.bulkInsert('Permissions', [{ ...PERMISSION, createdAt: now }]);
    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    await qi.sequelize.query(
      `INSERT INTO RolePermissions (roleId, permissionId, granted)
       SELECT r.id, :pid, 1 FROM Roles r WHERE r.name = 'System Administrator'
         AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
      { replacements: { pid: perm.id } }
    );
  },

  // Back to one target per priority (the Incident rows; a business-day
  // target becomes that many 24-hour days in minutes), pausing statuses
  // (all off), no due date history or permission.
  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (perm) {
      await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: perm.id } });
      await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: perm.id } });
    }
    await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: PERMISSION.key } });

    await qi.dropTable('TicketDueDateChanges');
    await qi.addColumn('TicketStatuses', 'pausesSla', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    await qi.removeColumn('TicketSlas', 'resolutionOriginalDueAt');
    await qi.removeColumn('TicketSlas', 'ticketType');

    await qi.sequelize.query("DELETE FROM SlaTargets WHERE ticketType <> 'incident'");
    for (const c of CLOCKS) {
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query(`UPDATE SlaTargets SET ${c}Minutes = ${c}Minutes * 1440 WHERE ${c}Unit = 'business_days' AND ${c}Minutes IS NOT NULL`);
      // eslint-disable-next-line no-await-in-loop
      await qi.removeColumn('SlaTargets', `${c}Unit`);
    }
    await qi.addIndex('SlaTargets', ['slaPolicyId', 'priority'], { unique: true, name: OLD_INDEX });
    await qi.removeIndex('SlaTargets', NEW_INDEX);
    await qi.removeColumn('SlaTargets', 'ticketType');
  },
};
