'use strict';

// tickets.assign and tickets.close are retired (user decision 2026-10-14).
// The API never checked them: anyone who can edit a ticket may reassign it,
// to themselves or anyone else, and close it from the ticket. They only hid
// controls in the UI, so they are removed with their role grants and
// per-user overrides.

const PERMISSIONS = [
  { key: 'tickets.assign', category: 'tickets', label: 'Assign tickets', description: 'Assign tickets to other users' },
  { key: 'tickets.close', category: 'tickets', label: 'Close tickets', description: 'Close or resolve tickets' },
];
const KEYS = PERMISSIONS.map((p) => p.key);
// down: the seeded roles that held them (20260101000020).
const SEEDED_HOLDERS = ['System Administrator', 'System Technician', 'Department Manager'];

module.exports = {
  up: async (queryInterface) => {
    const db = queryInterface.sequelize;
    await db.transaction(async (t) => {
      await db.query(`DELETE rp FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId
        WHERE p.\`key\` IN (:keys)`, { replacements: { keys: KEYS }, transaction: t });
      await db.query('DELETE FROM UserPermissionOverrides WHERE permissionKey IN (:keys)', { replacements: { keys: KEYS }, transaction: t });
      await db.query('DELETE FROM Permissions WHERE `key` IN (:keys)', { replacements: { keys: KEYS }, transaction: t });
    });
  },

  down: async (queryInterface) => {
    const db = queryInterface.sequelize;
    await db.transaction(async (t) => {
      await queryInterface.bulkInsert('Permissions', PERMISSIONS.map((p) => ({ ...p, createdAt: new Date() })), { transaction: t });
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT r.id, p.id, 1 FROM Roles r JOIN Permissions p ON p.\`key\` IN (:keys)
        WHERE r.isSystemRole = 1 AND r.name IN (:roles)`,
      { replacements: { keys: KEYS, roles: SEEDED_HOLDERS }, transaction: t });
    });
  },
};
