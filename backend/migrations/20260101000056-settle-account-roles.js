'use strict';

// Repairs account roles left inconsistent before every role change settled
// them (services/accountRoles.js, 2026-10-11):
// - an account's main role (Users.roleId) must be a role it holds: a main
//   role with no assignment row gets one; an account whose main role was
//   removed gets the best role it still holds (Owner, then System
//   Administrator, then its oldest assignment);
// - the legacy marker Users.role is 'admin' exactly while the account holds
//   Owner or System Administrator. Removing a top role on the roles tab never
//   cleared it, and it still opens the older admin-only gates. It is cleared
//   only while an active Owner exists, so no install loses its last way in;
// - role assignments, permission overrides and company access of deleted
//   accounts are removed.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const run = (sql, replacements, transaction) => db.query(sql, { replacements, transaction });
    await db.transaction(async (t) => {
      for (const table of ['UserRoles', 'UserPermissionOverrides', 'UserCompanyAccess']) {
        // eslint-disable-next-line no-await-in-loop
        await run(`DELETE FROM \`${table}\` WHERE userId NOT IN (SELECT id FROM Users)`, {}, t);
      }
      const now = new Date();
      await run(`INSERT INTO UserRoles (userId, roleId, assignedAt)
        SELECT u.id, u.roleId, :now FROM Users u
        WHERE u.roleId IS NOT NULL AND EXISTS (SELECT 1 FROM Roles r WHERE r.id = u.roleId)
          AND NOT EXISTS (SELECT 1 FROM UserRoles ur WHERE ur.userId = u.id AND ur.roleId = u.roleId)`, { now }, t);

      const top = await select("SELECT id, name FROM Roles WHERE isSystemRole = 1 AND name IN ('Owner', 'System Administrator')", {}, t);
      const ownerId = top.find((r) => r.name === 'Owner')?.id ?? null;
      const adminId = top.find((r) => r.name === 'System Administrator')?.id ?? null;
      const topIds = [ownerId, adminId].filter((id) => id !== null);

      const users = await select('SELECT id, role, roleId, isActive FROM Users', {}, t);
      const held = await select('SELECT userId, roleId FROM UserRoles ORDER BY assignedAt ASC, id ASC', {}, t);
      const heldBy = new Map();
      for (const h of held) {
        if (!heldBy.has(h.userId)) heldBy.set(h.userId, []);
        heldBy.get(h.userId).push(h.roleId);
      }
      // An owner: the Owner role, or (once migration 057 has run) the mark.
      const marked = (await queryInterface.describeTable('Users')).ownerLevel
        ? (await select("SELECT id FROM Users WHERE isActive = 1 AND ownerLevel IS NOT NULL", {}, t)).map((u) => u.id)
        : [];
      const activeOwner = marked.length > 0 || users.some((u) => Number(u.isActive) && (heldBy.get(u.id) || []).includes(ownerId));

      for (const u of users) {
        const roles = heldBy.get(u.id) || [];
        let { roleId } = u;
        if (!roles.includes(roleId)) {
          roleId = [ownerId, adminId].find((id) => id !== null && roles.includes(id)) ?? roles[0] ?? null;
        }
        const holdsTop = roles.some((id) => topIds.includes(id));
        let { role } = u;
        if (holdsTop) role = 'admin';
        else if (role === 'admin' && activeOwner) role = 'technician';
        if (roleId !== u.roleId || role !== u.role) {
          // eslint-disable-next-line no-await-in-loop
          await run('UPDATE Users SET roleId = :roleId, role = :role WHERE id = :id', { roleId, role, id: u.id }, t);
        }
      }
    });
  },

  // A repair: there is nothing to put back.
  down: async () => {},
};
