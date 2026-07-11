'use strict';

// Adds the 5 assets.* permission keys and grants them to the two seed roles
// named in the spec (System Administrator, System Technician) — follows the
// same Permissions/RolePermissions bulkInsert pattern as the original
// roles/permissions foundation migration (20260101000020).

const PERMISSIONS = [
  { key: 'assets.view', category: 'assets', label: 'View assets', description: 'View the asset inventory' },
  { key: 'assets.create', category: 'assets', label: 'Create assets', description: 'Add new assets to the inventory' },
  { key: 'assets.edit', category: 'assets', label: 'Edit assets', description: 'Edit asset details, assignment, and lifecycle info' },
  { key: 'assets.delete', category: 'assets', label: 'Delete assets', description: 'Remove assets from the inventory' },
  { key: 'assets.link_tickets', category: 'assets', label: 'Link assets to tickets', description: 'Link or unlink assets on a ticket' },
];

const ROLE_GRANTS = {
  'System Administrator': ['assets.view', 'assets.create', 'assets.edit', 'assets.delete', 'assets.link_tickets'],
  'System Technician': ['assets.view', 'assets.create', 'assets.edit', 'assets.link_tickets'],
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;

    const existing = await queryInterface.sequelize.query(
      "SELECT `key` FROM `Permissions` WHERE `key` LIKE 'assets.%'",
      { type: QueryTypes.SELECT }
    );
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = PERMISSIONS.filter((p) => !existingKeys.has(p.key));
    if (toInsert.length) {
      await queryInterface.bulkInsert('Permissions', toInsert.map((p) => ({ ...p, createdAt: new Date() })));
    }

    const permRows = await queryInterface.sequelize.query("SELECT `id`, `key` FROM `Permissions` WHERE `key` LIKE 'assets.%'", {
      type: QueryTypes.SELECT,
    });
    const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

    const roleRows = await queryInterface.sequelize.query(
      "SELECT `id`, `name` FROM `Roles` WHERE `name` IN ('System Administrator', 'System Technician')",
      { type: QueryTypes.SELECT }
    );
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    const rolePermissionRows = [];
    for (const [roleName, keys] of Object.entries(ROLE_GRANTS)) {
      const roleId = roleIdByName.get(roleName);
      if (!roleId) continue; // eslint-disable-line no-continue
      for (const key of keys) {
        const permissionId = permIdByKey.get(key);
        if (permissionId) rolePermissionRows.push({ roleId, permissionId, granted: true });
      }
    }
    if (rolePermissionRows.length) {
      await queryInterface.bulkInsert('RolePermissions', rolePermissionRows);
    }
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const permRows = await queryInterface.sequelize.query("SELECT `id` FROM `Permissions` WHERE `key` LIKE 'assets.%'", {
      type: QueryTypes.SELECT,
    });
    const permIds = permRows.map((r) => r.id);
    if (permIds.length) {
      await queryInterface.bulkDelete('RolePermissions', { permissionId: permIds });
      await queryInterface.bulkDelete('Permissions', { id: permIds });
    }
  },
};
