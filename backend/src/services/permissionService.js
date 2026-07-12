// Resolves a user's effective permissions from their assigned roles plus any
// personal overrides, and caches the result in memory for the process
// lifetime (this app runs as a single backend instance — see the migration
// investigation notes; there is no Redis dependency here).
//
// Resolution priority (highest wins):
//   1. user_permission_overrides (unexpired) for that permission key
//   2. role_permissions — granted if ANY of the user's roles grants it
//   3. default: false
const { Op } = require('sequelize');
const {
  User, UserRole, RolePermission, Permission, UserPermissionOverride, Role, ProjectMember,
} = require('../models');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // userId -> { permissions, expiresAt }

function getCached(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.permissions;
}

// Call whenever a user's roles or overrides change (role assignment,
// role_permissions edit, override create/update/delete).
function invalidateUserPermissions(userId) {
  cache.delete(userId);
}

// Call whenever a role's permission grants change — affects every user
// holding that role, and we don't track that reverse mapping in-cache.
function invalidateAllPermissions() {
  cache.clear();
}

async function resolveUserPermissions(userId) {
  const cached = getCached(userId);
  if (cached) return cached;

  const [allPermissions, user, userRoles] = await Promise.all([
    Permission.findAll({ attributes: ['id', 'key'] }),
    User.findByPk(userId, { attributes: ['id', 'roleId'] }),
    UserRole.findAll({ where: { userId }, attributes: ['roleId'] }),
  ]);

  const roleIds = new Set(userRoles.map((ur) => ur.roleId));
  if (user && user.roleId) roleIds.add(user.roleId);

  const permissions = {};
  allPermissions.forEach((p) => { permissions[p.key] = false; });

  if (roleIds.size > 0) {
    const permByIdKey = new Map(allPermissions.map((p) => [p.id, p.key]));
    const rolePermissions = await RolePermission.findAll({
      where: { roleId: { [Op.in]: [...roleIds] }, granted: true },
      attributes: ['permissionId'],
    });
    rolePermissions.forEach((rp) => {
      const key = permByIdKey.get(rp.permissionId);
      if (key) permissions[key] = true;
    });
  }

  const overrides = await UserPermissionOverride.findAll({
    where: {
      userId,
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
    },
    attributes: ['permissionKey', 'granted'],
  });
  overrides.forEach((o) => { permissions[o.permissionKey] = !!o.granted; });

  cache.set(userId, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
  return permissions;
}

async function hasPermission(userId, permissionKey) {
  const permissions = await resolveUserPermissions(userId);
  return !!permissions[permissionKey];
}

// Any of the given keys being granted satisfies the check (used for
// "requires X minimum" routes where X is the lowest of several tiers).
async function hasAnyPermission(userId, permissionKeys) {
  const permissions = await resolveUserPermissions(userId);
  return permissionKeys.some((key) => !!permissions[key]);
}

async function getUserTicketScope(userId) {
  const permissions = await resolveUserPermissions(userId);
  if (permissions['tickets.view_all']) return 'all';
  if (permissions['tickets.view_department']) return 'department';
  return 'own';
}

async function getUserProjectScope(userId) {
  const permissions = await resolveUserPermissions(userId);
  if (permissions['projects.view_all']) return 'all';
  if (permissions['projects.view_department']) return 'department';
  return 'own';
}

// Scope for the Reports module specifically — reports.view_own/department/all
// are their own permission family (distinct from tickets.*/projects.*),
// since a report can span both domains at once.
async function getUserReportScope(userId) {
  const permissions = await resolveUserPermissions(userId);
  if (permissions['reports.view_all']) return 'all';
  if (permissions['reports.view_department']) return 'department';
  return 'own';
}

// Same resolution as resolveUserPermissions, but returns the *why* behind
// each key too — used to power the read-only "effective permissions" view
// on a user's detail page. Not cached (admin-only, low-traffic view).
async function explainUserPermissions(userId) {
  const [allPermissions, user, userRoles] = await Promise.all([
    Permission.findAll({ order: [['category', 'ASC'], ['id', 'ASC']] }),
    User.findByPk(userId, { attributes: ['id', 'roleId'] }),
    UserRole.findAll({ where: { userId }, attributes: ['roleId'] }),
  ]);

  const roleIds = new Set(userRoles.map((ur) => ur.roleId));
  if (user && user.roleId) roleIds.add(user.roleId);
  const roles = roleIds.size ? await Role.findAll({ where: { id: [...roleIds] } }) : [];
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

  const permByIdKey = new Map(allPermissions.map((p) => [p.id, p.key]));
  const rolePermissions = roleIds.size
    ? await RolePermission.findAll({ where: { roleId: { [Op.in]: [...roleIds] }, granted: true } })
    : [];
  const grantingRoles = new Map(); // permissionKey -> [roleName, ...]
  rolePermissions.forEach((rp) => {
    const key = permByIdKey.get(rp.permissionId);
    const roleName = roleNameById.get(rp.roleId);
    if (!key || !roleName) return;
    if (!grantingRoles.has(key)) grantingRoles.set(key, []);
    grantingRoles.get(key).push(roleName);
  });

  const overrides = await UserPermissionOverride.findAll({
    where: {
      userId,
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
    },
  });
  const overrideByKey = new Map(overrides.map((o) => [o.permissionKey, o]));

  return allPermissions.map((p) => {
    const override = overrideByKey.get(p.key);
    if (override) {
      const until = override.expiresAt ? ` until ${new Date(override.expiresAt).toISOString()}` : ' permanently';
      return {
        key: p.key,
        category: p.category,
        label: p.label,
        description: p.description,
        granted: !!override.granted,
        source: `Override: ${override.granted ? 'granted' : 'denied'}${until}`,
      };
    }
    const roleNames = grantingRoles.get(p.key);
    if (roleNames && roleNames.length) {
      return {
        key: p.key,
        category: p.category,
        label: p.label,
        description: p.description,
        granted: true,
        source: `Role: ${roleNames.join(', ')}`,
      };
    }
    return {
      key: p.key, category: p.category, label: p.label, description: p.description, granted: false, source: null,
    };
  });
}

// Record-level access checks — the list endpoints (GET /tickets, GET
// /projects) already filter by scope via a `where` clause, but the
// single-record endpoints (GET /tickets/:id, GET /projects/:id and their
// sub-resources) previously only checked "does this user have ANY view
// permission" via requirePermission(), then fetched the record by raw id
// with no scope filter — meaning an 'own'-scoped user could read any
// ticket/project in the system just by knowing (or guessing) its id. These
// mirror the exact same scope semantics as the list `where` clauses above,
// applied to one already-fetched record instead of a query.
async function canAccessTicket(user, ticket) {
  const scope = await getUserTicketScope(user.id);
  if (scope === 'all') return true;
  if (scope === 'department') return ticket.departmentId === user.departmentId || ticket.assigneeId === user.id;
  return ticket.assigneeId === user.id;
}

async function canAccessProject(user, project) {
  const scope = await getUserProjectScope(user.id);
  if (scope === 'all') return true;
  const isMember = !!(await ProjectMember.findOne({ where: { projectId: project.id, userId: user.id } }));
  if (scope === 'department') {
    return project.ownerDepartmentId === user.departmentId || project.forDepartmentId === user.departmentId || isMember;
  }
  return isMember;
}

module.exports = {
  resolveUserPermissions,
  hasPermission,
  hasAnyPermission,
  getUserTicketScope,
  getUserProjectScope,
  getUserReportScope,
  canAccessTicket,
  canAccessProject,
  invalidateUserPermissions,
  invalidateAllPermissions,
  explainUserPermissions,
};
