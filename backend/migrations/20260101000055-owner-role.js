'use strict';

// The Owner (user decision 2026-10-11): a locked role above System
// Administrator. Only Owners make System Administrators or Owners, change an
// administrator's account, or change sign-in, mail and integration settings,
// so one rogue System Administrator can't take the system over. An Owner holds
// every permission (permissionService treats the role so; the grants here
// keep listings honest). The oldest active administrator becomes the Owner:
// on a fresh install, the bootstrap account created at setup.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      let [role] = await select("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", {}, t);
      if (!role) {
        await queryInterface.bulkInsert('Roles', [{
          name: 'Owner',
          description: 'Owns this PRISM: every permission, and the only one who can make System Administrators or change their accounts and the sign-in, mail and integration settings.',
          isSystemRole: true, scope: 'system', createdAt: new Date(), updatedAt: new Date(),
        }], { transaction: t });
        [role] = await select("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", {}, t);
      }
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT :roleId, p.id, 1 FROM Permissions p
        WHERE NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = :roleId AND x.permissionId = p.id)`,
      { replacements: { roleId: role.id }, transaction: t });
      const [hasOwner] = await select('SELECT userId FROM UserRoles WHERE roleId = :roleId LIMIT 1', { roleId: role.id }, t);
      if (!hasOwner) {
        const [first] = await select(`SELECT u.id FROM Users u
          WHERE u.isActive = 1 AND (u.role = 'admin'
            OR u.roleId IN (SELECT id FROM Roles WHERE name = 'System Administrator' AND isSystemRole = 1)
            OR EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
                       WHERE ur.userId = u.id AND r.name = 'System Administrator' AND r.isSystemRole = 1))
          ORDER BY u.id ASC LIMIT 1`, {}, t);
        if (first) {
          await queryInterface.bulkInsert('UserRoles', [{ userId: first.id, roleId: role.id, assignedAt: new Date() }], { transaction: t });
        }
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    const db = queryInterface.sequelize;
    const [role] = await db.query("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", { type: Sequelize.QueryTypes.SELECT });
    if (!role) return;
    await db.transaction(async (t) => {
      await db.query('DELETE FROM UserRoles WHERE roleId = :id', { replacements: { id: role.id }, transaction: t });
      await db.query('DELETE FROM RolePermissions WHERE roleId = :id', { replacements: { id: role.id }, transaction: t });
      await db.query('UPDATE Users SET roleId = NULL WHERE roleId = :id', { replacements: { id: role.id }, transaction: t });
      await db.query('DELETE FROM Roles WHERE id = :id', { replacements: { id: role.id }, transaction: t });
    });
  },
};
