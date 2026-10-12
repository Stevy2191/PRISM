'use strict';

const bcrypt = require('bcryptjs');

// Ownership becomes a mark on a System Administrator's account instead of a
// role (user decision 2026-10-11): Users.ownerLevel is 'owner' (exactly one,
// on a local account) or 'secondary' (any number, set by the owner). The
// Owner role is removed; everyone who held it keeps or gets System
// Administrator.
//
// Who becomes the owner: the oldest active local account holding the Owner
// role that has been used (not still on the default password or due its
// first change); failing that, the oldest active local one; failing that,
// the oldest active local System Administrator by the same rule. Every other
// active Owner becomes a secondary owner.

const ROLE_REFS = [
  ['UserRoles', 'roleId'], ['RolePermissions', 'roleId'], ['RoleCompanyAccess', 'roleId'], ['SsoGroupMappings', 'roleId'],
];
const NULLABLE_REFS = [['SsoProviders', 'defaultRoleId'], ['Departments', 'defaultRoleId']];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const run = (sql, replacements, transaction) => db.query(sql, { replacements, transaction });

    const columns = await queryInterface.describeTable('Users');
    if (!columns.ownerLevel) {
      await queryInterface.addColumn('Users', 'ownerLevel', { type: Sequelize.STRING(16), allowNull: true, defaultValue: null });
    }

    await db.transaction(async (t) => {
      const [admin] = await select("SELECT id FROM Roles WHERE name = 'System Administrator' AND isSystemRole = 1", {}, t);
      const [owner] = await select("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", {}, t);
      const holdersOf = (roleId) => select(`SELECT u.id, u.isLocalAccount, u.passwordHash, u.mustChangePassword FROM Users u
        WHERE u.isActive = 1 AND (u.roleId = :roleId OR EXISTS (SELECT 1 FROM UserRoles ur WHERE ur.userId = u.id AND ur.roleId = :roleId))
        ORDER BY u.id ASC`, { roleId }, t);
      const unused = (a) => !!Number(a.mustChangePassword) || (a.passwordHash && bcrypt.compareSync('changeme', a.passwordHash));
      const pick = (list) => {
        const local = list.filter((a) => Number(a.isLocalAccount));
        return local.find((a) => !unused(a)) || local[0] || null;
      };

      const [existing] = await select("SELECT id FROM Users WHERE ownerLevel = 'owner' LIMIT 1", {}, t);
      const owners = owner ? await holdersOf(owner.id) : [];
      let crown = existing ? null : pick(owners);
      if (!existing && !crown && admin) crown = pick(await holdersOf(admin.id));
      const marks = [];
      if (crown) marks.push([crown.id, 'owner']);
      for (const o of owners) if (!crown || o.id !== crown.id) marks.push([o.id, 'secondary']);

      for (const [userId, level] of marks) {
        // eslint-disable-next-line no-await-in-loop
        await run("UPDATE Users SET ownerLevel = :level, role = 'admin' WHERE id = :userId AND (ownerLevel IS NULL OR ownerLevel <> 'owner')", { level, userId }, t);
        if (admin) {
          // eslint-disable-next-line no-await-in-loop
          await run(`INSERT INTO UserRoles (userId, roleId, assignedAt)
            SELECT :userId, :roleId, NOW() FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM UserRoles WHERE userId = :userId AND roleId = :roleId)`, { userId, roleId: admin.id }, t);
        }
      }

      if (owner) {
        if (admin) await run('UPDATE Users SET roleId = :admin WHERE roleId = :owner', { admin: admin.id, owner: owner.id }, t);
        else await run('UPDATE Users SET roleId = NULL WHERE roleId = :owner', { owner: owner.id }, t);
        for (const [table, column] of NULLABLE_REFS) {
          // eslint-disable-next-line no-await-in-loop
          await run(`UPDATE \`${table}\` SET \`${column}\` = NULL WHERE \`${column}\` = :owner`, { owner: owner.id }, t);
        }
        for (const [table, column] of ROLE_REFS) {
          // eslint-disable-next-line no-await-in-loop
          await run(`DELETE FROM \`${table}\` WHERE \`${column}\` = :owner`, { owner: owner.id }, t);
        }
        await run('DELETE FROM Roles WHERE id = :owner', { owner: owner.id }, t);
      }
    });
  },

  // Puts the Owner role back on the marked accounts.
  down: async (queryInterface, Sequelize) => {
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
      await db.query(`INSERT INTO UserRoles (userId, roleId, assignedAt)
        SELECT u.id, :roleId, NOW() FROM Users u WHERE u.ownerLevel IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM UserRoles ur WHERE ur.userId = u.id AND ur.roleId = :roleId)`,
      { replacements: { roleId: role.id }, transaction: t });
    });
    await queryInterface.removeColumn('Users', 'ownerLevel');
  },
};
