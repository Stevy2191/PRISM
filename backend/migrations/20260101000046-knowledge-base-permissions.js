'use strict';

// Knowledge Base permissions — same Permissions/RolePermissions bulkInsert
// pattern as 20260101000043-licenses-contracts-permissions.js.
//   kb.view   — read the internal KB (both seed roles)
//   kb.manage — create/edit/delete articles AND categories (both seed roles;
//               per product decision any agent can author)
// The public /kb portal needs no permission — it's auth-less by design and
// only ever serves published + public articles.

const PERMISSIONS = [
  { key: 'kb.view', category: 'knowledge', label: 'View knowledge base', description: 'Read internal knowledge base articles' },
  { key: 'kb.manage', category: 'knowledge', label: 'Manage knowledge base', description: 'Create, edit, and delete articles and categories' },
];

const ROLE_GRANTS = {
  'System Administrator': ['kb.view', 'kb.manage'],
  'System Technician': ['kb.view', 'kb.manage'],
};

const KEYS = PERMISSIONS.map((p) => p.key);
const inList = `('${KEYS.join("', '")}')`;

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;

    const existing = await queryInterface.sequelize.query(
      `SELECT \`key\` FROM \`Permissions\` WHERE \`key\` IN ${inList}`,
      { type: QueryTypes.SELECT }
    );
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = PERMISSIONS.filter((p) => !existingKeys.has(p.key));
    if (toInsert.length) {
      await queryInterface.bulkInsert('Permissions', toInsert.map((p) => ({ ...p, createdAt: new Date() })));
    }

    const permRows = await queryInterface.sequelize.query(
      `SELECT \`id\`, \`key\` FROM \`Permissions\` WHERE \`key\` IN ${inList}`,
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
      `SELECT \`id\` FROM \`Permissions\` WHERE \`key\` IN ${inList}`,
      { type: QueryTypes.SELECT }
    );
    const permIds = permRows.map((r) => r.id);
    if (permIds.length) {
      await queryInterface.bulkDelete('RolePermissions', { permissionId: permIds });
      await queryInterface.bulkDelete('Permissions', { id: permIds });
    }
  },
};
