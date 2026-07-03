const { Notification, Ticket } = require('../models');
const { asyncHandler } = require('../middleware/error');
const { syncDerivedNotifications } = require('../services/notifications');

const ticketAttrs = ['id', 'title'];

// GET /notifications — unread notifications for the logged-in user.
const list = asyncHandler(async (req, res) => {
  await syncDerivedNotifications(req.user.id);
  const notifications = await Notification.findAll({
    where: { userId: req.user.id, isRead: false },
    include: [{ model: Ticket, as: 'ticket', attributes: ticketAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ notifications });
});

// PATCH /notifications/read-all
const readAll = asyncHandler(async (req, res) => {
  await Notification.update(
    { isRead: true },
    { where: { userId: req.user.id, isRead: false } }
  );
  res.json({ ok: true });
});

module.exports = { list, readAll };
