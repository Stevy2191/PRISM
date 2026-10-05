// Who may hand out a role. A role is a bundle of permissions and, through
// RoleCompanyAccess, of company reach — so giving one is privilege-granting,
// and every path that does it (role assignment, a user's legacy role, the
// role a new account starts with, a department's default role) applies the
// same rules (S11; plan 2a review R8):
//   - nobody changes their own roles;
//   - only a System Administrator (who can't be company-fenced) can grant
//     System Administrator;
//   - a fenced granter can't grant a role that reaches companies they can't.
const { Role, RoleCompanyAccess } = require('../models');
const { ApiError } = require('../middleware/error');
const { isUnfenceable, getUserCompanyIds } = require('./permissionService');

const SYSTEM_ADMIN = 'System Administrator';

async function assertCanGrantSystemAdmin(actor) {
  if (!(await isUnfenceable(actor))) {
    throw new ApiError(403, 'Only a System Administrator can grant the System Administrator role', 'FORBIDDEN');
  }
}

function assertNotSelf(actor, targetUserId) {
  if (targetUserId !== undefined && targetUserId === actor.id) {
    throw new ApiError(403, 'You cannot change your own roles', 'FORBIDDEN');
  }
}

// `role` is a loaded Role. `targetUserId` is omitted when no user is the
// target yet (a department's default role).
async function assertCanGrantRole(actor, role, targetUserId) {
  assertNotSelf(actor, targetUserId);
  if (role.name === SYSTEM_ADMIN) await assertCanGrantSystemAdmin(actor);
  const reachable = await getUserCompanyIds(actor);
  if (reachable === null) return;
  const rows = await RoleCompanyAccess.findAll({ where: { roleId: role.id }, attributes: ['companyId'] });
  if (rows.some((r) => !reachable.includes(r.companyId))) {
    throw new ApiError(403, 'You can only grant companies you can reach', 'FORBIDDEN');
  }
}

// The legacy User.role enum: 'admin' maps to System Administrator.
async function assertCanSetLegacyRole(actor, legacyRole, targetUserId) {
  assertNotSelf(actor, targetUserId);
  if (legacyRole === 'admin') await assertCanGrantSystemAdmin(actor);
  const seed = await Role.findOne({ where: { name: legacyRole === 'admin' ? SYSTEM_ADMIN : 'System Technician', isSystemRole: true } });
  if (seed) await assertCanGrantRole(actor, seed, undefined);
}

module.exports = { assertCanGrantRole, assertCanSetLegacyRole, assertCanGrantSystemAdmin };
