// Notification generation. Event-driven notifications (assigned, reply,
// comment, status_change) are created inline by the controller action that
// triggers them. Time-based notifications (overdue, due_soon) have no
// triggering request, so there is no cron/job scheduler in this app to fire
// them proactively — instead syncDerivedNotifications() is called whenever a
// user's notifications or dashboard are fetched, and idempotently inserts at
// most one notification per ticket per type.
const { Op } = require('sequelize');
const {
  Notification, Ticket, Project, TicketWatcher, TeamMember, SystemSettings, User,
} = require('../models');
const { getTicketStatusBuckets } = require('./statusBehavior');
const { orgToday, addDays } = require('../utils/orgTime');

const DUE_SOON_DAYS = 2;

function truncate(text, len) {
  const clean = String(text || '').trim();
  return clean.length > len ? `${clean.slice(0, len)}…` : clean;
}

// Settings -> Notifications: a system-wide on/off per event type. Missing
// or unparseable setting = everything enabled (matches the pre-this-feature
// behavior, so an unconfigured instance doesn't suddenly go silent).
async function isTypeEnabled(type) {
  const row = await SystemSettings.findOne({ where: { key: 'notifications.enabledTypes' } });
  if (!row?.value) return true;
  try {
    const enabled = JSON.parse(row.value);
    return Array.isArray(enabled) ? enabled.includes(type) : true;
  } catch {
    return true;
  }
}

// A notification about a ticket carries its title or comment text, so it only
// goes to someone who can reach the ticket's company. An assignee or watcher
// can end up outside it (a contact moving with its tickets, an assignment
// made before their access changed).
async function canReachTicket(userId, ticketId) {
  // Lazy: permissionService requires the models this file is loaded beside.
  const { canAccessCompany } = require('./permissionService'); // eslint-disable-line global-require
  const [user, ticket] = await Promise.all([
    User.findByPk(userId, { attributes: ['id', 'role', 'roleId', 'allCompanies'] }),
    Ticket.findByPk(ticketId, { attributes: ['id', 'companyId'] }),
  ]);
  return !!(user && ticket && (await canAccessCompany(user, ticket.companyId)));
}

// A notification about a project names its tasks, so it only goes to someone
// who can still open the project (current scope rules) and still work its
// company: a helper can be fenced off from the company after being added.
async function canReachProject(userId, projectId) {
  // Lazy: permissionService requires the models this file is loaded beside.
  const { canAccessProject } = require('./permissionService'); // eslint-disable-line global-require
  const [user, project] = await Promise.all([User.findByPk(userId), Project.findByPk(projectId)]);
  return !!(user && user.isActive && project && (await canAccessProject(user, project)));
}

async function createNotification({
  userId, type, message, ticketId = null, projectId = null,
}) {
  if (!userId) return null;
  if (!(await isTypeEnabled(type))) return null;
  if (ticketId && !(await canReachTicket(userId, ticketId))) return null;
  if (projectId && !(await canReachProject(userId, projectId))) return null;
  const notification = await Notification.create({ userId, type, message, ticketId, projectId });
  // Some types also email the user (their preference, else the admin
  // default); queued after this request. Lazy: the mail modules load the
  // settings controller, which loads this one.
  require('./email/notificationMail').queueNotificationEmail(notification); // eslint-disable-line global-require
  return notification;
}

// A ticket landing in a team's queue unassigned (created there, or moved
// there): every member hears about it, except whoever put it there.
async function notifyNewInQueue(ticket, actorId) {
  if (!ticket.teamId || ticket.assigneeId) return;
  const members = await TeamMember.findAll({ where: { teamId: ticket.teamId }, attributes: ['userId'], order: [['userId', 'ASC']] });
  // eslint-disable-next-line no-restricted-syntax
  for (const { userId } of members) {
    if (userId === actorId) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await createNotification({
      userId, type: 'new_in_queue', message: `New ticket in your team's queue: ${ticket.title}`, ticketId: ticket.id,
    });
  }
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

// A comment was added — notify the assignee (the contact who owns the
// ticket has no PRISM login/notification inbox to reach). The author is
// never notified of their own comment.
async function notifyComment(ticket, comment, authorId) {
  if (ticket.assigneeId && ticket.assigneeId !== authorId) {
    await createNotification({
      userId: ticket.assigneeId,
      type: 'comment',
      message: `Someone commented on ticket: ${truncate(comment.body, 80)}`,
      ticketId: ticket.id,
    });
  }
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
  const today = await orgToday();
  const soonStr = addDays(today, DUE_SOON_DAYS);

  // Only tickets whose status currently behaves as "open" are candidates —
  // closed AND archived tickets are both excluded, rather than a hardcoded
  // "not closed" name check that would incorrectly include archived ones.
  const buckets = await getTicketStatusBuckets();
  const { companyScopeWhere } = require('./permissionService'); // eslint-disable-line global-require
  const user = await User.findByPk(userId, { attributes: ['id', 'role', 'roleId', 'allCompanies'] });
  if (!user) return;
  const candidates = await Ticket.findAll({
    where: {
      assigneeId: userId,
      status: { [Op.in]: buckets.open },
      dueDate: { [Op.ne]: null },
      ...(await companyScopeWhere(user)),
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

// Security alerts (virus blocked, scanner unavailable) go to every active
// user holding settings.manage_system. Always on: written directly, so the
// admin's per-type switches (isTypeEnabled) can't silence them, and no ticket
// or email is involved. Never throws — an alert failing must not fail the
// upload it is about.
async function notifySecurityAdmins({ type, message }) {
  try {
    const { activeUserIdsWithPermission } = require('./permissionService'); // eslint-disable-line global-require
    const userIds = await activeUserIdsWithPermission('settings.manage_system');
    let sent = 0;
    for (const userId of userIds) {
      // eslint-disable-next-line no-await-in-loop
      await Notification.create({ userId, type, message, ticketId: null });
      sent += 1;
    }
    return sent;
  } catch (e) {
    console.error(`[virus-scan] could not notify admins: ${e.message}`);
    return 0;
  }
}

module.exports = {
  canReachProject,
  notifySecurityAdmins,
  createNotification,
  notifyAssigned,
  notifyComment,
  notifyWatchers,
  notifyNewInQueue,
  syncDerivedNotifications,
};
