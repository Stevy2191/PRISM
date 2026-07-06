const { SystemAuditLog, User } = require('../models');
const { asyncHandler } = require('../middleware/error');

const userAttrs = ['id', 'displayName', 'username'];

// GET /audit-log?page=&limit=&action=&actorUserId=&targetUserId=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const offset = (page - 1) * limit;

  const where = {};
  if (req.query.action) where.action = req.query.action;
  if (req.query.actorUserId) where.actorUserId = parseInt(req.query.actorUserId, 10);
  if (req.query.targetUserId) where.targetUserId = parseInt(req.query.targetUserId, 10);

  const { rows, count } = await SystemAuditLog.findAndCountAll({
    where,
    include: [
      { model: User, as: 'actor', attributes: userAttrs },
      { model: User, as: 'target', attributes: userAttrs },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  res.json({
    logs: rows,
    page,
    limit,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / limit)),
  });
});

module.exports = { list };
