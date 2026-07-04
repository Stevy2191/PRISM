// Notification generation. Event-driven notifications (assigned, reply,
// comment, status_change) are created inline by the controller action that
// triggers them. Time-based notifications (overdue, due_soon) have no
// triggering request, so there is no cron/job scheduler in this app to fire
// them proactively — instead syncDerivedNotifications() is called whenever a
// user's notifications or dashboard are fetched, and idempotently inserts at
// most one notification per ticket per type.
const { Op } = require('sequelize');
const { Notification, Ticket, TicketWatcher } = require('../models');

const DUE_SOON_DAYS = 2;
// Matches the default seeded TicketStatuses rows' names — see the matching
// note in dashboardController.js.
const CLOSED_STATUSES = ['Resolved', 'Closed'];

function truncate(text, len) {
  const clean = String(text || '').trim();
  return clean.length > len ? `${clean.slice(0, len)}…` : clean;
}

async function createNotification({ userId, type, message, ticketId = null }) {
  if (!userId) return null;
  return Notification.create({ userId, type, message, ticketId });
}

// Ticket assigned (on create or reassignment). Never notifies the actor
// assigning the ticket to themselves.
async function notifyAssigned(ticket, actorId) {
  if (!ticket.assigneeId || ticket.assigneeId === actorId) return;
  await createNotification({
    userId: ticket.assigneeId,
    type: 'assigned',
    message: `Ticket assigned to you: ${ticket.title}`,
    ticketId: ticket.id,
  });
}

// A comment was added. The requester's own comment on their ticket is a
// "reply" to the assignee; anyone else's comment is a generic "comment"
// notification to the other parties. The author is never notified of their
// own comment.
async function notifyComment(ticket, comment, authorId) {
  if (authorId === ticket.requesterId) {
    if (ticket.assigneeId && ticket.assigneeId !== authorId) {
      await createNotification({
        userId: ticket.assigneeId,
        type: 'reply',
        message: `Customer replied to your ticket: ${truncate(comment.body, 80)}`,
        ticketId: ticket.id,
      });
    }
    return;
  }

  const recipients = new Set();
  if (ticket.requesterId && ticket.requesterId !== authorId) recipients.add(ticket.requesterId);
  if (ticket.assigneeId && ticket.assigneeId !== authorId) recipients.add(ticket.assigneeId);

  // eslint-disable-next-line no-restricted-syntax
  for (const userId of recipients) {
    // eslint-disable-next-line no-await-in-loop
    await createNotification({
      userId,
      type: 'comment',
      message: `Someone commented on ticket: ${ticket.title}`,
      ticketId: ticket.id,
    });
  }
}

// Staff changed a ticket's status — notify the requester (the ticket's
// implicit "watcher"). Not sent when the requester made the change themselves.
async function notifyStatusChange(ticket, actorId, newStatus) {
  if (!ticket.requesterId || ticket.requesterId === actorId) return;
  await createNotification({
    userId: ticket.requesterId,
    type: 'status_change',
    message: `Status changed to "${String(newStatus).replace(/_/g, ' ')}" on ticket: ${ticket.title}`,
    ticketId: ticket.id,
  });
}

// Notifies a ticket's watchers (create/comment/status-change events), skipping
// anyone in excludeUserIds (typically the actor, plus whoever already got a
// more specific notification for this same event) so people aren't double-notified.
async function notifyWatchers(ticket, message, excludeUserIds = []) {
  const exclude = new Set(excludeUserIds.filter(Boolean));
  const watchers = await TicketWatcher.findAll({ where: { ticketId: ticket.id } });

  // eslint-disable-next-line no-restricted-syntax
  for (const watcher of watchers) {
    if (exclude.has(watcher.userId)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await createNotification({
      userId: watcher.userId,
      type: 'watcher_update',
      message,
      ticketId: ticket.id,
    });
  }
}

// Derives overdue / due-soon notifications for a user's assigned tickets.
// Idempotent — only inserts a notification the first time a ticket qualifies.
async function syncDerivedNotifications(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + DUE_SOON_DAYS);
  const soonStr = soon.toISOString().slice(0, 10);

  const candidates = await Ticket.findAll({
    where: {
      assigneeId: userId,
      status: { [Op.notIn]: CLOSED_STATUSES },
      dueDate: { [Op.ne]: null },
    },
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const ticket of candidates) {
    const isOverdue = ticket.dueDate < today;
    const isDueSoon = !isOverdue && ticket.projectId && ticket.dueDate <= soonStr;
    if (!isOverdue && !isDueSoon) continue; // eslint-disable-line no-continue

    const type = isOverdue ? 'overdue' : 'due_soon';
    // eslint-disable-next-line no-await-in-loop
    const existing = await Notification.findOne({ where: { userId, ticketId: ticket.id, type } });
    if (existing) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    await createNotification({
      userId,
      type,
      message:
        type === 'overdue'
          ? `Ticket is now overdue: ${ticket.title}`
          : `Task due date approaching: ${ticket.title}`,
      ticketId: ticket.id,
    });
  }
}

module.exports = {
  createNotification,
  notifyAssigned,
  notifyComment,
  notifyStatusChange,
  notifyWatchers,
  syncDerivedNotifications,
};
