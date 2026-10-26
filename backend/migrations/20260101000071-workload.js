'use strict';

// Workload (sub-project 6): per-person weekly work hours, the optional planned
// date on a ticket (the SLA due date never moves), the two system-wide
// workload settings and the permission workload.view. The permission goes to
// every role that already sees all tickets or all projects.

const PERMISSION = {
  key: 'workload.view', category: 'workload', label: 'View workload', description: 'Open the Workload screen',
};
const DEFAULT_WORK_HOURS = JSON.stringify({
  1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0, 7: 0,
});
const SETTINGS = {
  'workload.defaultWorkHours': DEFAULT_WORK_HOURS,
  'workload.defaultTicketMinutes': '60',
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: dt.QueryTypes.SELECT, replacements });
    const now = new Date();

    if (!(await qi.describeTable('Users')).workHours) {
      await qi.addColumn('Users', 'workHours', { type: dt.JSON, allowNull: true });
    }
    if (!(await qi.describeTable('Tickets')).plannedDate) {
      await qi.addColumn('Tickets', 'plannedDate', { type: dt.DATEONLY, allowNull: true });
      await qi.addIndex('Tickets', ['plannedDate'], { name: 'tickets_planned_date' });
    }

    for (const [key, value] of Object.entries(SETTINGS)) {
      // eslint-disable-next-line no-await-in-loop
      const [existing] = await select('SELECT `key` FROM SystemSettings WHERE `key` = :key', { key });
      // eslint-disable-next-line no-await-in-loop
      if (!existing) await qi.sequelize.query('INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES (:key, :value, NOW())', { replacements: { key, value } });
    }

    const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (!existing) await qi.bulkInsert('Permissions', [{ ...PERMISSION, createdAt: now }]);
    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    await qi.sequelize.query(
      `INSERT INTO RolePermissions (roleId, permissionId, granted)
       SELECT DISTINCT rp.roleId, :pid, 1
         FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId
        WHERE p.\`key\` IN ('tickets.view_all', 'projects.view_all') AND rp.granted = 1
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = rp.roleId AND x.permissionId = :pid)`,
      { replacements: { pid: perm.id } }
    );
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (perm) {
      await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: perm.id } });
      await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: perm.id } });
    }
    await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: PERMISSION.key } });
    await qi.sequelize.query("DELETE FROM SystemSettings WHERE `key` IN ('workload.defaultWorkHours', 'workload.defaultTicketMinutes')");

    if ((await qi.describeTable('Tickets')).plannedDate) {
      await qi.removeIndex('Tickets', 'tickets_planned_date').catch(() => {});
      await qi.removeColumn('Tickets', 'plannedDate');
    }
    if ((await qi.describeTable('Users')).workHours) await qi.removeColumn('Users', 'workHours');
  },
};
