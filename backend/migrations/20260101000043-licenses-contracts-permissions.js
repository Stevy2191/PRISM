'use strict';

// Adds the 3 licenses/contracts permission keys (namespaced under `assets.`
// since the module lives inside the Assets section) and grants them to the
// two seed roles — same Permissions/RolePermissions bulkInsert pattern as
// 20260101000040-asset-permissions.js. Read access to licenses/contracts
// reuses the existing `assets.view` key rather than adding a new one (not
// listed in the spec's permission set), consistent with them being
// sub-sections of Assets.

const PERMISSIONS = [
  { key: 'assets.manage_licenses', category: 'assets', label: 'Manage licenses', description: 'Create, edit, and delete software licenses' },
  { key: 'assets.manage_contracts', category: 'assets', label: 'Manage contracts', description: 'Create, edit, and delete vendor contracts' },
  { key: 'assets.view_license_keys', category: 'assets', label: 'View license keys', description: 'Reveal masked software license keys' },
];

const ROLE_GRANTS = {
  'System Administrator': ['assets.manage_licenses', 'assets.manage_contracts', 'assets.view_license_keys'],
  'System Technician': ['assets.manage_licenses', 'assets.manage_contracts'],
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;

    const existing = await queryInterface.sequelize.query(
      "SELECT `key` FROM `Permissions` WHERE `key` IN ('assets.manage_licenses', 'assets.manage_contracts', 'assets.view_license_keys')",
      { type: QueryTypes.SELECT }
    );
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = PERMISSIONS.filter((p) => !existingKeys.has(p.key));
    if (toInsert.length) {
      await queryInterface.bulkInsert('Permissions', toInsert.map((p) => ({ ...p, createdAt: new Date() })));
    }

    const permRows = await queryInterface.sequelize.query(
      "SELECT `id`, `key` FROM `Permissions` WHERE `key` IN ('assets.manage_licenses', 'assets.manage_contracts', 'assets.view_license_keys')",
      { type: QueryTypes.SELECT }
    );
    const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

    const roleRows = await queryInterface.sequelize.query(
      "SELECT `id`, `name` FROM `Roles` WHERE `name` IN ('System Administrator', 'System Technician')",
      { type: QueryTypes.SELECT }
    );
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    const existingGrants = await queryInterface.sequelize.query(
      'SELECT `roleId`, `permissionId` FROM `RolePermissions` WHERE `permissionId` IN (:permIds)',
      { type: QueryTypes.SELECT, replacements: { permIds: permRows.map((r) => r.id).length ? permRows.map((r) => r.id) : [0] } }
    );
    const existingGrantSet = new Set(existingGrants.map((r) => `${r.roleId}:${r.permissionId}`));

    const rolePermissionRows = [];
    for (const [roleName, keys] of Object.entries(ROLE_GRANTS)) {
      const roleId = roleIdByName.get(roleName);
      if (!roleId) continue; // eslint-disable-line no-continue
      for (const key of keys) {
        const permissionId = permIdByKey.get(key);
        if (permissionId && !existingGrantSet.has(`${roleId}:${permissionId}`)) {
          rolePermissionRows.push({ roleId, permissionId, granted: true });
        }
      }
    }
    if (rolePermissionRows.length) {
      await queryInterface.bulkInsert('RolePermissions', rolePermissionRows);
    }
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const permRows = await queryInterface.sequelize.query(
      "SELECT `id` FROM `Permissions` WHERE `key` IN ('assets.manage_licenses', 'assets.manage_contracts', 'assets.view_license_keys')",
      { type: QueryTypes.SELECT }
    );
    const permIds = permRows.map((r) => r.id);
    if (permIds.length) {
      await queryInterface.bulkDelete('RolePermissions', { permissionId: permIds });
      await queryInterface.bulkDelete('Permissions', { id: permIds });
    }
  },
};
