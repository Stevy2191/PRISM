const { fn, col } = require('sequelize');
const {
  Role, Permission, RolePermission, UserRole, User, Department, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { invalidateAllPermissions, invalidateUserPermissions } = require('../services/permissionService');

const roleInclude = [
  { model: Permission, as: 'permissions', through: { attributes: ['granted'] } },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
];

// System Administrator is "fully locked" — nothing about it can be edited,
// not even its permission grants (every other system role's permissions CAN
// be edited; only its name/description/scope/deletion are locked, same as
// every other system role).
const isFullyLocked = (role) => role.isSystemRole && role.name === 'System Administrator';

async function memberCounts() {
  const rows = await UserRole.findAll({
    attributes: ['roleId', [fn('COUNT', col('id')), 'count']],
    group: ['roleId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.roleId, Number(r.count)]));
}

// GET /roles — list every role with its granted permissions, member count
const list = asyncHandler(async (req, res) => {
  const [roles, counts] = await Promise.all([
    Role.findAll({ include: roleInclude, order: [['isSystemRole', 'DESC'], ['name', 'ASC']] }),
    memberCounts(),
  ]);
  const withCounts = roles.map((r) => {
    const json = r.toJSON();
    json.memberCount = counts.get(r.id) || 0;
    json.permissionCount = json.permissions.length;
    return json;
  });
  res.json({ roles: withCounts });
});

// POST /roles — create a custom role
// Body: { name, description?, scope?, departmentId?, permissionKeys?: string[] }
const create = asyncHandler(async (req, res) => {
  const { name, description, scope, departmentId, permissionKeys } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Role name is required', 'VALIDATION_ERROR');
  }
  if (scope !== undefined && !['system', 'department'].includes(scope)) {
    throw new ApiError(400, 'scope must be "system" or "department"', 'VALIDATION_ERROR');
  }

  const keys = Array.isArray(permissionKeys) ? permissionKeys : [];
  const role = await sequelize.transaction(async (t) => {
    const created = await Role.create(
      {
        name: name.trim(),
        description: description || null,
        scope: scope || 'system',
        departmentId: departmentId || null,
        isSystemRole: false,
      },
      { transaction: t }
    );

    if (keys.length) {
      const permissions = await Permission.findAll({ where: { key: keys }, transaction: t });
      await RolePermission.bulkCreate(
        permissions.map((p) => ({ roleId: created.id, permissionId: p.id, granted: true })),
        { transaction: t }
      );
    }

    return created;
  });

  await writeAudit(req, 'role.create', 'Role', role.id, { name: role.name });
  // A brand-new role has no members yet, but clear the cache defensively in
  // case of a stale in-flight assignment racing this creation.
  invalidateAllPermissions();

  const fresh = await Role.findByPk(role.id, { include: roleInclude });
  res.status(201).json({ role: fresh });
});

// GET /roles/:id — role metadata + every permission (granted true/false) so
// the editor can render a toggle for all of them, not just the granted ones.
const get = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(req.params.id, { include: roleInclude });
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');

  const [allPermissions, counts] = await Promise.all([
    Permission.findAll({ order: [['category', 'ASC'], ['id', 'ASC']] }),
    memberCounts(),
  ]);
  const grantedKeys = new Set(role.permissions.map((p) => p.key));
  const permissions = allPermissions.map((p) => ({
    id: p.id,
    key: p.key,
    category: p.category,
    label: p.label,
    description: p.description,
    granted: grantedKeys.has(p.key),
  }));

  const json = role.toJSON();
  delete json.permissions;
  json.memberCount = counts.get(role.id) || 0;
  json.permissions = permissions;
  res.json({ role: json });
});

// PATCH /roles/:id — name/description/departmentId only. System roles keep
// fixed metadata (create a custom duplicate for a department-scoped variant).
const update = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  if (role.isSystemRole) {
    throw new ApiError(400, 'System roles cannot be renamed or rescoped — duplicate it to create a custom variant', 'SYSTEM_ROLE_LOCKED');
  }

  const { name, description, scope, departmentId } = req.body || {};
  const changes = {};
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Role name is required', 'VALIDATION_ERROR');
    changes.name = name.trim();
  }
  if (description !== undefined) changes.description = description || null;
  if (scope !== undefined) {
    if (!['system', 'department'].includes(scope)) throw new ApiError(400, 'scope must be "system" or "department"', 'VALIDATION_ERROR');
    changes.scope = scope;
  }
  if (departmentId !== undefined) changes.departmentId = departmentId || null;

  await role.update(changes);
  await writeAudit(req, 'role.update', 'Role', role.id, changes);

  const fresh = await Role.findByPk(role.id, { include: roleInclude });
  res.json({ role: fresh });
});

// DELETE /roles/:id — blocked for system roles. Affected users fall back to
// their department's default role, or lose their primary role assignment
// (roleId = null) if there isn't one.
const remove = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  if (role.isSystemRole) {
    throw new ApiError(400, 'System roles cannot be deleted', 'SYSTEM_ROLE_LOCKED');
  }

  const memberships = await UserRole.findAll({ where: { roleId: role.id } });
  const affectedUserIds = memberships.map((m) => m.userId);
  const affectedUsers = affectedUserIds.length
    ? await User.findAll({ where: { id: affectedUserIds }, include: [{ model: Department, as: 'department' }] })
    : [];

  await sequelize.transaction(async (t) => {
    await UserRole.destroy({ where: { roleId: role.id }, transaction: t });
    await RolePermission.destroy({ where: { roleId: role.id }, transaction: t });
    // Departments that pointed to this role as their default would otherwise
    // leave a dangling reference — clear it so future lookups (and the
    // fallback below) never reassign users onto the role being deleted.
    await Department.update({ defaultRoleId: null }, { where: { defaultRoleId: role.id }, transaction: t });

    for (const user of affectedUsers) {
      if (user.roleId !== role.id) continue; // eslint-disable-line no-continue
      const deptDefault = user.department?.defaultRoleId;
      const fallbackRoleId = deptDefault && deptDefault !== role.id ? deptDefault : null;
      // eslint-disable-next-line no-await-in-loop
      await user.update({ roleId: fallbackRoleId }, { transaction: t });
      if (fallbackRoleId) {
        // eslint-disable-next-line no-await-in-loop
        await UserRole.create(
          { userId: user.id, roleId: fallbackRoleId, assignedAt: new Date(), assignedBy: req.user.id },
          { transaction: t }
        );
      }
    }

    await role.destroy({ transaction: t });
  });

  affectedUserIds.forEach((userId) => invalidateUserPermissions(userId));
  await writeAudit(req, 'role.delete', 'Role', role.id, { name: role.name, affectedUserCount: affectedUserIds.length });

  res.json({ ok: true, affectedUserCount: affectedUserIds.length });
});

// POST /roles/:id/permissions — bulk-set the role's granted permissions.
// Body: { permissions: { "tickets.view_all": true, "projects.create": false, ... } }
const setPermissions = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  if (isFullyLocked(role)) {
    throw new ApiError(400, 'System Administrator permissions cannot be changed', 'SYSTEM_ROLE_LOCKED');
  }

  const map = req.body?.permissions;
  if (!map || typeof map !== 'object') {
    throw new ApiError(400, 'permissions must be an object of { key: granted }', 'VALIDATION_ERROR');
  }

  const grantedKeys = Object.keys(map).filter((k) => !!map[k]);
  const permissions = grantedKeys.length ? await Permission.findAll({ where: { key: grantedKeys } }) : [];

  await sequelize.transaction(async (t) => {
    await RolePermission.destroy({ where: { roleId: role.id }, transaction: t });
    if (permissions.length) {
      await RolePermission.bulkCreate(
        permissions.map((p) => ({ roleId: role.id, permissionId: p.id, granted: true })),
        { transaction: t }
      );
    }
  });

  invalidateAllPermissions();
  await writeAudit(req, 'role.set_permissions', 'Role', role.id, { grantedCount: permissions.length });

  const fresh = await Role.findByPk(role.id, { include: roleInclude });
  res.json({ role: fresh });
});

// PATCH /roles/:id/permissions/:permissionKey — toggle a single permission.
// Body: { granted: boolean }
const togglePermission = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  if (isFullyLocked(role)) {
    throw new ApiError(400, 'System Administrator permissions cannot be changed', 'SYSTEM_ROLE_LOCKED');
  }

  const permission = await Permission.findOne({ where: { key: req.params.permissionKey } });
  if (!permission) throw new ApiError(404, 'Permission not found', 'NOT_FOUND');

  const granted = !!req.body?.granted;
  if (granted) {
    const [row] = await RolePermission.findOrCreate({
      where: { roleId: role.id, permissionId: permission.id },
      defaults: { granted: true },
    });
    if (!row.granted) await row.update({ granted: true });
  } else {
    await RolePermission.destroy({ where: { roleId: role.id, permissionId: permission.id } });
  }

  invalidateAllPermissions();
  await writeAudit(req, 'role.toggle_permission', 'Role', role.id, { key: permission.key, granted });

  res.json({ ok: true, key: permission.key, granted });
});

module.exports = { list, create, get, update, remove, setPermissions, togglePermission };
