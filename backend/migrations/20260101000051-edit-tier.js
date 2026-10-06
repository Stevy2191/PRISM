'use strict';

// Edit tier (sub-project 3, plan 3b-2). Writes now check *.edit_* against the
// record; the seeded System Technician gets tickets.edit_all and
// projects.edit_all so default installs behave as before (spec decision
// Q26). projects.log_time retires: time.log (plan 3b-1) replaced it, and
// logging your own time needs only view access (user decision 2026-10-06).

const TECH_GRANTS = ['tickets.edit_all', 'projects.edit_all'];
const RETIRED = {
  key: 'projects.log_time', category: 'projects', label: 'Log time', description: 'Log time entries on projects',
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT r.id, p.id, 1 FROM Roles r JOIN Permissions p ON p.\`key\` IN (:keys)
        WHERE r.name = 'System Technician' AND r.isSystemRole = 1
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = p.id)`,
      { replacements: { keys: TECH_GRANTS }, transaction: t });
      const [retired] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: RETIRED.key }, t);
      if (retired) {
        await db.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: retired.id }, transaction: t });
        await db.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: retired.id }, transaction: t });
      }
      await db.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: RETIRED.key }, transaction: t });
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      await db.query(`DELETE rp FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
        WHERE r.name = 'System Technician' AND r.isSystemRole = 1 AND p.\`key\` IN (:keys)`, { replacements: { keys: TECH_GRANTS }, transaction: t });
      let [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: RETIRED.key }, t);
      if (!perm) {
        await queryInterface.bulkInsert('Permissions', [{ ...RETIRED, createdAt: new Date() }], { transaction: t });
        [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: RETIRED.key }, t);
      }
      // Every role that can log time again can log project time.
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT rp.roleId, :id, 1 FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId
        WHERE p.\`key\` = 'time.log' AND rp.granted = 1
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = rp.roleId AND x.permissionId = :id)`,
      { replacements: { id: perm.id }, transaction: t });
    });
  },
};
