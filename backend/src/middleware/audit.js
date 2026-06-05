// Helper to record state-changing actions in the AuditLog table.
const { AuditLog } = require('../models');

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

module.exports = { writeAudit };
