'use strict';

// Moderation gets its own permissions (user decision 2026-10-11). Editing or
// deleting someone else's comment or attachment, or deleting their project
// file, used to follow from tickets/projects.edit_all or edit_department.
// Plan 3b-2 gave the seeded System Technician edit_all, which would have
// made it a moderator; it edits everything but doesn't moderate colleagues.
// Every role and user who could moderate before keeps it: roles holding
// edit_all or edit_department (except the System Technician system role),
// and active per-user grants of those.

const PERMISSIONS = [
  {
    key: 'tickets.moderate', category: 'tickets', label: "Moderate others' comments and attachments",
    description: "Edit or delete other people's ticket comments and attachments (with tickets.edit_all, or edit_department in your department)",
  },
  {
    key: 'projects.moderate', category: 'projects', label: "Delete others' project files",
    description: "Delete files other people uploaded to a project (with projects.edit_all, or edit_department in your department)",
  },
];
const SOURCES = {
  'tickets.moderate': ['tickets.edit_all', 'tickets.edit_department'],
  'projects.moderate': ['projects.edit_all', 'projects.edit_department'],
};
const KEYS = PERMISSIONS.map((p) => p.key);

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      const existing = new Set((await select('SELECT `key` FROM Permissions WHERE `key` IN (:keys)', { keys: KEYS }, t)).map((r) => r.key));
      const fresh = PERMISSIONS.filter((p) => !existing.has(p.key)).map((p) => ({ ...p, createdAt: new Date() }));
      if (fresh.length) await queryInterface.bulkInsert('Permissions', fresh, { transaction: t });
      for (const [key, sources] of Object.entries(SOURCES)) {
        // eslint-disable-next-line no-await-in-loop
        const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key }, t);
        // eslint-disable-next-line no-await-in-loop
        await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
          SELECT DISTINCT rp.roleId, :id, 1 FROM RolePermissions rp
            JOIN Permissions p ON p.id = rp.permissionId JOIN Roles r ON r.id = rp.roleId
          WHERE rp.granted = 1 AND p.\`key\` IN (:sources)
            AND NOT (r.name = 'System Technician' AND r.isSystemRole = 1)
            AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = rp.roleId AND x.permissionId = :id)`,
        { replacements: { id: perm.id, sources }, transaction: t });
        // A user granted an edit tier by override could moderate with it.
        // eslint-disable-next-line no-await-in-loop
        await db.query(`INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, reason, expiresAt, grantedBy, createdAt)
          SELECT o.userId, :key, 1, MIN(o.reason), MAX(o.expiresAt), MIN(o.grantedBy), NOW() FROM UserPermissionOverrides o
          WHERE o.permissionKey IN (:sources) AND o.granted = 1 AND (o.expiresAt IS NULL OR o.expiresAt > NOW())
            AND NOT EXISTS (SELECT 1 FROM UserPermissionOverrides x WHERE x.userId = o.userId AND x.permissionKey = :key)
          GROUP BY o.userId`,
        { replacements: { key, sources }, transaction: t });
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    await db.transaction(async (t) => {
      const ids = (await db.query('SELECT id FROM Permissions WHERE `key` IN (:keys)', { type: QueryTypes.SELECT, replacements: { keys: KEYS }, transaction: t }))
        .map((r) => r.id);
      if (ids.length) {
        await db.query('DELETE FROM RolePermissions WHERE permissionId IN (:ids)', { replacements: { ids }, transaction: t });
        await db.query('DELETE FROM Permissions WHERE id IN (:ids)', { replacements: { ids }, transaction: t });
      }
      await db.query('DELETE FROM UserPermissionOverrides WHERE permissionKey IN (:keys)', { replacements: { keys: KEYS }, transaction: t });
    });
  },
};
