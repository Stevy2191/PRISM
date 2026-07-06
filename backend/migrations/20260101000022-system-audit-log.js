'use strict';

/**
 * Dedicated audit trail for permission-related changes (role assignment,
 * role removal, permission override grant/revoke) — distinct from the
 * general-purpose `AuditLogs` table (which logs ticket/project/user CRUD via
 * writeAudit()). Kept separate per spec: different shape (actor vs. target
 * user), narrower purpose, and its own read endpoint gated by
 * settings.view_audit_log rather than being folded into the generic log.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, JSON: JSONType, DATE } = Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    await queryInterface.createTable('SystemAuditLogs', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      actorUserId: { type: INTEGER, allowNull: true },
      targetUserId: { type: INTEGER, allowNull: true },
      action: { type: STRING(50), allowNull: false },
      detail: { type: JSONType, allowNull: true },
      createdAt: now,
    });
    await queryInterface.addIndex('SystemAuditLogs', ['actorUserId']);
    await queryInterface.addIndex('SystemAuditLogs', ['targetUserId']);
    await queryInterface.addIndex('SystemAuditLogs', ['action']);
    await queryInterface.addIndex('SystemAuditLogs', ['createdAt']);

    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS `SystemAuditLogs`');
    return undefined;
  },
};
