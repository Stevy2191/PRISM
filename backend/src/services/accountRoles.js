// An account's main role (Users.roleId: what the screens show) and its legacy
// role marker (Users.role) follow the roles it holds (UserRoles). Called after
// every change to an account's roles.
//
// - The main role stays put while the account still holds it. Otherwise it
//   becomes the best role still held: System Administrator, then the oldest
//   assignment. With nothing left, the fallback role (the department default)
//   is assigned, else none. A caller handing out the fallback has checked the
//   actor may give it.
// - The legacy marker is 'admin' exactly while the account holds System
//   Administrator (as every owner does): older gates still read it
//   (requireRole('admin'), isUnfenceable), so an account demoted on the roles
//   tab must lose it.
const { Role, UserRole } = require('../models');
const { invalidateUserPermissions } = require('./permissionService');

async function systemAdminId(transaction) {
  const role = await Role.findOne({ where: { name: 'System Administrator', isSystemRole: true }, attributes: ['id'], transaction });
  return role ? role.id : null;
}

// The role the account would fall back to with nothing else left: whether it
// is needed (callers check the actor may hand it out first).
async function needsFallback(user, removingUserRoleIds, transaction) {
  const remaining = await UserRole.count({ where: { userId: user.id }, transaction });
  return remaining - removingUserRoleIds.length <= 0;
}

async function settleAccountRoles(user, { fallbackRoleId = null, assignedBy = null, transaction } = {}) {
  const held = await UserRole.findAll({
    where: { userId: user.id }, order: [['assignedAt', 'ASC'], ['id', 'ASC']], transaction,
  });
  const admin = await systemAdminId(transaction);
  const heldIds = held.map((ur) => ur.roleId);
  const changes = {};

  if (!heldIds.includes(user.roleId)) {
    let next = (admin && heldIds.includes(admin) ? admin : heldIds[0]) ?? null;
    if (next === null && fallbackRoleId) {
      await UserRole.create({
        userId: user.id, roleId: fallbackRoleId, assignedAt: new Date(), assignedBy,
      }, { transaction });
      heldIds.push(fallbackRoleId);
      next = fallbackRoleId;
    }
    if (next !== user.roleId) changes.roleId = next;
  }

  const holdsTop = !!admin && heldIds.includes(admin);
  if (holdsTop && user.role !== 'admin') changes.role = 'admin';
  if (!holdsTop && user.role === 'admin') changes.role = 'technician';

  if (Object.keys(changes).length) await user.update(changes, { transaction });
  invalidateUserPermissions(user.id);
  return user;
}

module.exports = { settleAccountRoles, needsFallback };
