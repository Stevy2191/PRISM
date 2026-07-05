const { Role, Permission, RolePermission, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { invalidateAllPermissions } = require('../services/permissionService');

const roleInclude = [
  { model: Permission, as: 'permissions', through: { attributes: ['granted'] } },
];

// GET /roles — list every role with its granted permissions
const list = asyncHandler(async (req, res) => {
  const roles = await Role.findAll({ include: roleInclude, order: [['name', 'ASC']] });
  res.json({ roles });
});

// POST /roles — create a custom role
// Body: { name, description?, departmentId?, permissionKeys?: string[] }
const create = asyncHandler(async (req, res) => {
  const { name, description, departmentId, permissionKeys } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Role name is required', 'VALIDATION_ERROR');
  }

  const keys = Array.isArray(permissionKeys) ? permissionKeys : [];
  const role = await sequelize.transaction(async (t) => {
    const created = await Role.create(
      { name: name.trim(), description: description || null, departmentId: departmentId || null, isSystemRole: false },
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

module.exports = { list, create };
