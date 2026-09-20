const { SystemAuditLog, User } = require('../models');
const { asyncHandler } = require('../middleware/error');
const { parsePagination, paginated } = require('../utils/pagination');

const userAttrs = ['id', 'displayName', 'username'];

// GET /audit-log?page=&limit=&action=&actorUserId=&targetUserId=
const list = asyncHandler(async (req, res) => {
  // 25 rather than the shared default — audit rows are dense and this page
  // has always shown 25.
  const { page, limit, offset } = parsePagination(req, { defaultLimit: 25, maxLimit: 100 });

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
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });

  res.json(paginated('logs', { rows, count }, { page, limit }));
});

module.exports = { list };
