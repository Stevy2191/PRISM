const { Op } = require('sequelize');
const { Ticket, Project, User, TimeEntry, Notification, AuditLog } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { syncDerivedNotifications } = require('../services/notifications');
const { getTicketStatusBuckets } = require('../services/statusBehavior');
const { computeProjectCompletion } = require('../services/projectCompletion');

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Monday 00:00 of the week containing `date`.
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// `behaviorByName` is the Map<statusName, behaviorType> for the current
// ticket_statuses table — passed in rather than a hardcoded list so a
// custom/renamed status is classified correctly the moment it exists.
function displayStatus(ticket, behaviorByName) {
  if (behaviorByName.get(ticket.status) === 'closed') return 'closed';
  if (ticket.dueDate && ticket.dueDate < todayStr()) return 'overdue';
  if (ticket.status === 'In Progress') return 'in_progress';
  return 'open';
}

// green (>14 days out), amber (<=14 days), red (overdue), none (no due date).
function dueDateBadge(dueDate) {
  if (!dueDate) return 'none';
  const days = Math.round((new Date(dueDate) - new Date(todayStr())) / 86400000);
  if (days < 0) return 'red';
  if (days <= 14) return 'amber';
  return 'green';
}

// Project completion is tracked project-wide (closed ProjectTasks / total
// ProjectTasks — see services/projectCompletion.js), regardless of which
// user's view is requesting it.
async function projectHealthFor(projectWhere) {
  const projects = await Project.findAll({ where: projectWhere, order: [['dueDate', 'ASC']] });

  return Promise.all(
    projects.map(async (project) => {
      const { percent, totalTasks, closedTasks } = await computeProjectCompletion(project.id);
      return {
        id: project.id,
        name: project.name,
        dueDate: project.dueDate,
        dueBadge: dueDateBadge(project.dueDate),
        totalTasks,
        closedTasks,
        openTasks: totalTasks - closedTasks,
        percent,
      };
    })
  );
}

async function statsForUser(userId, scopeField, buckets) {
  const today = todayStr();
  const thisWeekStart = startOfWeek(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const [openTickets, overdueTickets, highPriorityOpen, closedThisWeek, closedLastWeek] = await Promise.all([
    Ticket.count({ where: { [scopeField]: userId, status: { [Op.in]: buckets.open } } }),
    Ticket.count({
      // Only OPEN tickets can be "overdue" — archived/closed tickets are
      // hidden from this count rather than lumped in via a NOT-closed check.
      where: { [scopeField]: userId, status: { [Op.in]: buckets.open }, dueDate: { [Op.lt]: today } },
    }),
    Ticket.count({
      where: {
        [scopeField]: userId,
        status: { [Op.in]: buckets.open },
        priority: { [Op.in]: ['high', 'critical'] },
      },
    }),
    Ticket.count({ where: { [scopeField]: userId, resolvedAt: { [Op.gte]: thisWeekStart } } }),
    Ticket.count({
      where: { [scopeField]: userId, resolvedAt: { [Op.gte]: lastWeekStart, [Op.lt]: thisWeekStart } },
    }),
  ]);

  return {
    openTickets,
    overdueTickets,
    highPriorityOpen,
    closedThisWeek,
    closedLastWeek,
    closedDelta: closedThisWeek - closedLastWeek,
  };
}

async function systemStats(buckets) {
  const today = todayStr();
  const thisWeekStart = startOfWeek(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const [openTickets, overdueTickets, unassignedTickets, closedThisWeek, closedLastWeek] = await Promise.all([
    Ticket.count({ where: { status: { [Op.in]: buckets.open } } }),
    Ticket.count({ where: { status: { [Op.in]: buckets.open }, dueDate: { [Op.lt]: today } } }),
    Ticket.count({ where: { assigneeId: null, status: { [Op.in]: buckets.open } } }),
    Ticket.count({ where: { resolvedAt: { [Op.gte]: thisWeekStart } } }),
    Ticket.count({ where: { resolvedAt: { [Op.gte]: lastWeekStart, [Op.lt]: thisWeekStart } } }),
  ]);

  return {
    openTickets,
    overdueTickets,
    unassignedTickets,
    closedThisWeek,
    closedLastWeek,
    closedDelta: closedThisWeek - closedLastWeek,
  };
}

async function ticketsForUser(userId, scopeField, behaviorByName) {
  const tickets = await Ticket.findAll({
    where: { [scopeField]: userId },
    order: [['updatedAt', 'DESC']],
    limit: 20,
  });
  return tickets.map((t) => ({
    id: t.id,
    ticketNumber: String(t.id).padStart(5, '0'),
    title: t.title,
    status: t.status,
    displayStatus: displayStatus(t, behaviorByName),
    priority: t.priority,
    dueDate: t.dueDate,
    updatedAt: t.updatedAt,
  }));
}

async function notificationsForUser(userId) {
  await syncDerivedNotifications(userId);
  return Notification.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit: 20,
  });
}

async function hoursForUser(userId) {
  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const entries = await TimeEntry.findAll({
    where: { userId, loggedAt: { [Op.gte]: weekStart, [Op.lt]: weekEnd } },
    attributes: ['minutes', 'loggedAt'],
    raw: true,
  });

  const byDay = WEEKDAYS.map((label, i) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const dayStr = dayDate.toISOString().slice(0, 10);
    const minutes = entries
      .filter((e) => new Date(e.loggedAt).toISOString().slice(0, 10) === dayStr)
      .reduce((sum, e) => sum + e.minutes, 0);
    return { day: label, hours: Math.round((minutes / 60) * 10) / 10 };
  });

  const total = Math.round(byDay.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
  return { total, byDay };
}

async function teamWorkload(buckets) {
  const staffUsers = await User.findAll({
    where: { role: { [Op.in]: ['admin', 'technician'] } },
    attributes: ['id', 'displayName'],
  });
  const rows = await Promise.all(
    staffUsers.map(async (u) => ({
      userId: u.id,
      displayName: u.displayName,
      openCount: await Ticket.count({ where: { assigneeId: u.id, status: { [Op.in]: buckets.open } } }),
    }))
  );
  return rows.sort((a, b) => b.openCount - a.openCount);
}

// System-wide recent events: ticket opened/closed/assigned (from the audit
// log) merged with tickets currently overdue, newest first.
async function activityFeed(buckets) {
  const logs = await AuditLog.findAll({
    where: { entityType: 'Ticket', action: { [Op.in]: ['ticket.create', 'ticket.update'] } },
    include: [{ model: User, as: 'user', attributes: ['id', 'displayName'] }],
    order: [['createdAt', 'DESC']],
    limit: 15,
  });

  const ticketIds = [...new Set(logs.map((l) => l.entityId).filter(Boolean))];
  const tickets = ticketIds.length
    ? await Ticket.findAll({ where: { id: { [Op.in]: ticketIds } }, attributes: ['id', 'title'] })
    : [];
  const titleById = new Map(tickets.map((t) => [t.id, t.title]));

  const fromLogs = logs.map((log) => {
    let action = 'updated';
    if (log.action === 'ticket.create') action = 'opened';
    // Historical audit rows store whatever status name was current at the
    // time — if that status has since been renamed or deleted, this simply
    // won't match today's closed bucket, which is an acceptable limitation
    // of comparing a point-in-time snapshot against the live status table.
    else if (log.meta?.status && buckets.closed.includes(log.meta.status)) action = 'closed';
    else if (log.meta?.assigneeId !== undefined) action = 'assigned';

    return {
      id: `log-${log.id}`,
      actorName: log.user?.displayName || 'System',
      action,
      ticketId: log.entityId,
      ticketNumber: log.entityId ? String(log.entityId).padStart(5, '0') : null,
      ticketTitle: titleById.get(log.entityId) || log.meta?.title || null,
      occurredAt: log.createdAt,
    };
  });

  const today = todayStr();
  const overdueTickets = await Ticket.findAll({
    where: { status: { [Op.in]: buckets.open }, dueDate: { [Op.lt]: today } },
    order: [['dueDate', 'ASC']],
    limit: 5,
  });
  const fromOverdue = overdueTickets.map((t) => ({
    id: `overdue-${t.id}`,
    actorName: null,
    action: 'overdue',
    ticketId: t.id,
    ticketNumber: String(t.id).padStart(5, '0'),
    ticketTitle: t.title,
    occurredAt: t.dueDate,
  }));

  return [...fromLogs, ...fromOverdue]
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice(0, 20);
}

// GET /dashboard?userId= (admin only) — everything the dashboard page needs
// in one round trip. Modes:
//   admin_system   — admin, no userId: system-wide stats/workload/activity
//   admin_filtered — admin, userId given: another user's tech-mode dashboard
//   tech           — non-admin: the logged-in user's own dashboard
const get = asyncHandler(async (req, res) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  if (requestedUserId && req.user.role !== 'admin') {
    throw new ApiError(403, "Only admins may view another user's dashboard", 'FORBIDDEN');
  }

  // Fetched once per request and threaded through every stat below, so a
  // custom or renamed status is reflected immediately with no extra queries.
  const buckets = await getTicketStatusBuckets();
  const behaviorByName = new Map();
  buckets.open.forEach((name) => behaviorByName.set(name, 'open'));
  buckets.closed.forEach((name) => behaviorByName.set(name, 'closed'));
  buckets.archived.forEach((name) => behaviorByName.set(name, 'archived'));

  const isSystemWide = req.user.role === 'admin' && !requestedUserId;

  if (isSystemWide) {
    const [stats, projectHealth, workload, activity] = await Promise.all([
      systemStats(buckets),
      projectHealthFor({}),
      teamWorkload(buckets),
      activityFeed(buckets),
    ]);
    return res.json({
      mode: 'admin_system',
      viewingUser: null,
      stats,
      projectHealth,
      teamWorkload: workload,
      activity,
    });
  }

  const targetId = requestedUserId || req.user.id;
  const targetUser = requestedUserId ? await User.findByPk(targetId) : req.user;
  if (!targetUser) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  // Requesters never hold ticket assignments in this app's RBAC — their "my
  // work" is the tickets they filed. Staff (admin/technician) are scoped by
  // assignment instead.
  const scopeField = targetUser.role === 'requester' ? 'requesterId' : 'assigneeId';

  const taskProjectRows = await Ticket.findAll({
    where: { [scopeField]: targetId, projectId: { [Op.ne]: null } },
    attributes: ['projectId'],
    group: ['projectId'],
    raw: true,
  });
  const taskProjectIds = taskProjectRows.map((r) => r.projectId);

  const [stats, tickets, notifications, projectHealth, hours] = await Promise.all([
    statsForUser(targetId, scopeField, buckets),
    ticketsForUser(targetId, scopeField, behaviorByName),
    notificationsForUser(targetId),
    taskProjectIds.length ? projectHealthFor({ id: { [Op.in]: taskProjectIds } }) : [],
    hoursForUser(targetId),
  ]);

  res.json({
    mode: requestedUserId ? 'admin_filtered' : 'tech',
    viewingUser: { id: targetUser.id, displayName: targetUser.displayName },
    stats,
    tickets,
    notifications,
    projectHealth,
    hours,
  });
});

module.exports = { get };
