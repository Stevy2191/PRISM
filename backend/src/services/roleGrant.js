// Who may hand out a role. A role is a bundle of permissions and, through
// RoleCompanyAccess, of company reach — so giving one is privilege-granting,
// and every path that does it (role assignment, a user's legacy role, the
// role a new account starts with, a department's default role) applies the
// same rules (S11; plan 2a review R8):
//   - nobody changes their own roles;
//   - only a System Administrator (who can't be company-fenced) can grant
//     System Administrator;
//   - a fenced granter can't grant a role that reaches companies they can't.
// Editing what a role or user may do follows the same idea (plan 3c security
// review): nobody but a System Administrator changes the permissions of a
// role they hold, or grants a permission they don't hold themselves.
const { Role, RoleCompanyAccess, UserRole } = require('../models');
const { ApiError } = require('../middleware/error');
const { isUnfenceable, getUserCompanyIds, resolveUserPermissions } = require('./permissionService');

// Scope tiers: holding a broader one covers granting a narrower one.
const BROADER = {};
for (const [narrow, ...broader] of [
  ['tickets.view_own', 'tickets.view_department', 'tickets.view_all'],
  ['tickets.view_department', 'tickets.view_all'],
  ['tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all'],
  ['tickets.edit_department', 'tickets.edit_all'],
  ['projects.view_own', 'projects.view_department', 'projects.view_all'],
  ['projects.view_department', 'projects.view_all'],
  ['projects.edit_own', 'projects.edit_department', 'projects.edit_all'],
  ['projects.edit_department', 'projects.edit_all'],
  ['reports.view_own', 'reports.view_department', 'reports.view_all'],
  ['reports.view_department', 'reports.view_all'],
  ['people.view_own_department', 'people.view_all'],
]) BROADER[narrow] = broader;

// keys: permissions being granted (to a role, a new role or a user).
async function assertCanGrantPermissions(actor, keys) {
  if (!keys.length || (await isUnfenceable(actor))) return;
  const held = await resolveUserPermissions(actor.id);
  const holds = (key) => !!held[key] || (BROADER[key] || []).some((b) => !!held[b]);
  if (!keys.every(holds)) throw new ApiError(403, 'You can only grant permissions you hold', 'FORBIDDEN');
}

async function assertNotOwnRolePermissions(actor, role) {
  if (await isUnfenceable(actor)) return;
  const holds = actor.roleId === role.id
    || !!(await UserRole.findOne({ where: { userId: actor.id, roleId: role.id }, attributes: ['userId'] }));
  if (holds) throw new ApiError(403, 'You cannot change the permissions of a role you hold', 'FORBIDDEN');
}

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

// Handing a role to someone (assigning it, choosing it for a new account,
// making it a department's default): everything assertCanGrantRole checks,
// and — unless the actor is the owner (System Administrator, user decision
// 2026-10-11) — the role carries nothing more than the actor holds.
async function assertCanHandOutRole(actor, role, targetUserId) {
  await assertCanGrantRole(actor, role, targetUserId);
  if (await isUnfenceable(actor)) return;
  const { RolePermission, Permission } = require('../models'); // eslint-disable-line global-require
  const rows = await RolePermission.findAll({
    where: { roleId: role.id, granted: true }, include: [{ model: Permission, as: 'permission', attributes: ['key'] }],
  });
  await assertCanGrantPermissions(actor, rows.map((r) => r.permission?.key).filter(Boolean));
}

module.exports = {
  assertCanGrantRole,
  assertCanHandOutRole, assertCanSetLegacyRole, assertCanGrantSystemAdmin, assertCanGrantPermissions, assertNotOwnRolePermissions,
};
