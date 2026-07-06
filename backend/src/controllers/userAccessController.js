// Per-user role assignment, permission overrides, and effective-permission
// explain view — powers the "Roles & Permissions" tab on the user detail page.
const { User, Role, UserRole, Department, Permission, UserPermissionOverride } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit, writeSystemAudit } = require('../middleware/audit');
const { invalidateUserPermissions, explainUserPermissions } = require('../services/permissionService');

const userAttrs = ['id', 'displayName', 'username'];

async function loadUser(id) {
  const user = await User.findByPk(id, { include: [{ model: Department, as: 'department' }] });
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  return user;
}

// ---- Roles ----

// GET /users/:id/roles
const listRoles = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const userRoles = await UserRole.findAll({
    where: { userId: user.id },
    include: [
      { model: Role, as: 'role' },
      { model: User, as: 'assignedByUser', attributes: userAttrs },
    ],
    order: [['assignedAt', 'ASC']],
  });
  res.json({ userRoles, primaryRoleId: user.roleId });
});

// POST /users/:id/roles — Body: { roleId }
const assignRole = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const roleId = parseInt(req.body?.roleId, 10);
  if (!roleId) throw new ApiError(400, 'roleId is required', 'VALIDATION_ERROR');

  const role = await Role.findByPk(roleId);
  if (!role) throw new ApiError(400, 'Role does not exist', 'VALIDATION_ERROR');

  const [userRole, created] = await UserRole.findOrCreate({
    where: { userId: user.id, roleId },
    defaults: { assignedAt: new Date(), assignedBy: req.user.id },
  });
  if (!created) throw new ApiError(409, 'User already has this role', 'ALREADY_ASSIGNED');

  // A user with no primary role yet gets this one as primary automatically.
  if (!user.roleId) await user.update({ roleId });

  invalidateUserPermissions(user.id);
  await writeAudit(req, 'user.assign_role', 'User', user.id, { roleId, roleName: role.name });
  await writeSystemAudit(req, 'role_assigned', user.id, { roleId, roleName: role.name });

  const fresh = await UserRole.findByPk(userRole.id, {
    include: [{ model: Role, as: 'role' }, { model: User, as: 'assignedByUser', attributes: userAttrs }],
  });
  res.status(201).json({ userRole: fresh, primaryRoleId: user.roleId || roleId });
});

// DELETE /users/:id/roles/:roleId
const removeRole = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const roleId = parseInt(req.params.roleId, 10);

  const userRole = await UserRole.findOne({ where: { userId: user.id, roleId }, include: [{ model: Role, as: 'role' }] });
  if (!userRole) throw new ApiError(404, 'Role assignment not found', 'NOT_FOUND');
  const roleName = userRole.role?.name;
  await userRole.destroy();

  // Removing the primary role falls back to the user's department default,
  // same rule as deleting a role outright (see rolesController.remove).
  if (user.roleId === roleId) {
    const fallbackRoleId = user.department?.defaultRoleId || null;
    await user.update({ roleId: fallbackRoleId });
    if (fallbackRoleId) {
      await UserRole.findOrCreate({
        where: { userId: user.id, roleId: fallbackRoleId },
        defaults: { assignedAt: new Date(), assignedBy: req.user.id },
      });
    }
  }

  invalidateUserPermissions(user.id);
  await writeAudit(req, 'user.remove_role', 'User', user.id, { roleId });
  await writeSystemAudit(req, 'role_removed', user.id, { roleId, roleName });
  res.json({ ok: true, primaryRoleId: user.roleId });
});

// ---- Permission overrides ----

// GET /users/:id/overrides
const listOverrides = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const overrides = await UserPermissionOverride.findAll({
    where: { userId: user.id },
    include: [{ model: User, as: 'grantedByUser', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });

  const permissionByKey = new Map((await Permission.findAll()).map((p) => [p.key, p]));
  const withMeta = overrides.map((o) => {
    const json = o.toJSON();
    const permission = permissionByKey.get(o.permissionKey);
    json.label = permission?.label || o.permissionKey;
    json.category = permission?.category || null;
    json.expired = !!(o.expiresAt && new Date(o.expiresAt) <= new Date());
    return json;
  });
  res.json({ overrides: withMeta });
});

// POST /users/:id/overrides — Body: { permissionKey, granted, reason?, expiresAt? }
const createOverride = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const { permissionKey, granted, reason, expiresAt } = req.body || {};

  const permission = await Permission.findOne({ where: { key: permissionKey } });
  if (!permission) throw new ApiError(400, 'permissionKey does not exist', 'VALIDATION_ERROR');
  if (typeof granted !== 'boolean') throw new ApiError(400, 'granted must be true or false', 'VALIDATION_ERROR');

  let resolvedExpiresAt = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid expiresAt', 'VALIDATION_ERROR');
    resolvedExpiresAt = d;
  }

  const override = await UserPermissionOverride.create({
    userId: user.id,
    permissionKey,
    granted,
    reason: reason || null,
    expiresAt: resolvedExpiresAt,
    grantedBy: req.user.id,
  });

  invalidateUserPermissions(user.id);
  await writeAudit(req, 'user.create_override', 'User', user.id, { permissionKey, granted, expiresAt: resolvedExpiresAt });
  await writeSystemAudit(req, 'override_granted', user.id, {
    permissionKey, granted, reason: reason || null, expiresAt: resolvedExpiresAt,
  });

  const fresh = await UserPermissionOverride.findByPk(override.id, {
    include: [{ model: User, as: 'grantedByUser', attributes: userAttrs }],
  });
  res.status(201).json({ override: fresh });
});

// DELETE /users/:id/overrides/:overrideId
const revokeOverride = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const override = await UserPermissionOverride.findOne({ where: { id: req.params.overrideId, userId: user.id } });
  if (!override) throw new ApiError(404, 'Override not found', 'NOT_FOUND');

  await override.destroy();
  invalidateUserPermissions(user.id);
  await writeAudit(req, 'user.revoke_override', 'User', user.id, { permissionKey: override.permissionKey });
  await writeSystemAudit(req, 'override_revoked', user.id, {
    permissionKey: override.permissionKey, granted: override.granted, reason: override.reason,
  });
  res.json({ ok: true });
});

// ---- Effective permissions (read-only) ----

// GET /users/:id/permissions
const getEffectivePermissions = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.id);
  const permissions = await explainUserPermissions(user.id);
  res.json({ permissions });
});

module.exports = {
  listRoles, assignRole, removeRole, listOverrides, createOverride, revokeOverride, getEffectivePermissions,
};
