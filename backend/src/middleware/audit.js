// Helper to record state-changing actions in the AuditLog table.
const { AuditLog, SystemAuditLog } = require('../models');

/**
 * Write an audit log row. Best-effort: never throws into the request flow.
 * Pass a transaction via opts.transaction to tie it to surrounding work.
 *
 * @param {object} req - express request (for the acting user)
 * @param {string} action - e.g. 'ticket.create', 'user.update_role'
 * @param {string} entityType - e.g. 'Ticket'
 * @param {number|null} entityId
 * @param {object} [meta] - arbitrary JSON detail
 * @param {object} [opts] - { transaction }
 */
async function writeAudit(req, action, entityType, entityId, meta = null, opts = {}) {
  try {
    await AuditLog.create(
      {
        userId: req.user ? req.user.id : null,
        action,
        entityType: entityType || null,
        entityId: entityId || null,
        meta,
      },
      { transaction: opts.transaction }
    );
  } catch (err) {
    // Auditing must not break the primary operation; log and continue.
    console.error('[audit] failed to write log:', err.message);
  }
}

/**
 * Write a permission-change audit row (role_assigned, role_removed,
 * override_granted, override_revoked) to the dedicated SystemAuditLogs
 * table — separate from writeAudit()'s general-purpose log because it
 * tracks an actor/target pair rather than a single acting user, and powers
 * its own admin-only read endpoint (GET /audit-log). Best-effort, same as
 * writeAudit().
 *
 * @param {object} req - express request (for the acting user)
 * @param {string} action - 'role_assigned' | 'role_removed' | 'override_granted' | 'override_revoked'
 * @param {number} targetUserId - whose roles/permissions changed
 * @param {object} [detail] - e.g. { roleName, permissionKey, reason, expiresAt }
 * @param {object} [opts] - { transaction }
 */
async function writeSystemAudit(req, action, targetUserId, detail = null, opts = {}) {
  try {
    await SystemAuditLog.create(
      {
        actorUserId: req.user ? req.user.id : null,
        targetUserId: targetUserId || null,
        action,
        detail,
      },
      { transaction: opts.transaction }
    );
  } catch (err) {
    console.error('[audit] failed to write system audit log:', err.message);
  }
}

module.exports = { writeAudit, writeSystemAudit };
