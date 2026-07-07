const { Op } = require('sequelize');
const {
  Ticket, Project, User, TimeEntry, Notification, TicketActivity, ProjectActivity, DashboardLayout,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { syncDerivedNotifications } = require('../services/notifications');
const { getTicketStatusBuckets } = require('../services/statusBehavior');
const { computeProjectCompletion } = require('../services/projectCompletion');
const { hasPermission } = require('../services/permissionService');

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

// `extraWhere` narrows every count to a department (or any other Ticket
// column filter) — an empty object (the default) means system-wide, as before.
async function systemStats(buckets, extraWhere = {}) {
  const today = todayStr();
  const thisWeekStart = startOfWeek(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const [openTickets, overdueTickets, unassignedTickets, closedThisWeek, closedLastWeek] = await Promise.all([
    Ticket.count({ where: { ...extraWhere, status: { [Op.in]: buckets.open } } }),
    Ticket.count({ where: { ...extraWhere, status: { [Op.in]: buckets.open }, dueDate: { [Op.lt]: today } } }),
    Ticket.count({ where: { ...extraWhere, assigneeId: null, status: { [Op.in]: buckets.open } } }),
    Ticket.count({ where: { ...extraWhere, resolvedAt: { [Op.gte]: thisWeekStart } } }),
    Ticket.count({ where: { ...extraWhere, resolvedAt: { [Op.gte]: lastWeekStart, [Op.lt]: thisWeekStart } } }),
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

async function teamWorkload(buckets, extraUserWhere = {}) {
  const staffUsers = await User.findAll({
    where: { role: { [Op.in]: ['admin', 'technician'] }, ...extraUserWhere },
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

// Only these TicketActivity/ProjectActivity `action` values are meaningful
// enough to show on the dashboard feed — everything else (type/team/dept/
// dueDate changes, attachments, time logged, relations, custom fields, task
// created/deleted, expenses, materials, members, files) is real activity but
// too granular/low-value for an at-a-glance feed. The per-ticket/per-project
// Activity tabs (unaffected by this) remain the complete record.
const MEANINGFUL_TICKET_ACTIONS = ['created', 'status', 'assigneeId', 'priority', 'comment'];
const MEANINGFUL_PROJECT_ACTIONS = ['project_created', 'status_changed', 'task_closed'];
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function isClosedStatusName(name, buckets) {
  if (!name) return false;
  return buckets.closed.some((n) => n.toLowerCase() === String(name).toLowerCase());
}

// Ticket-side event -> { colorKey, verb, suffix }. `toValue`/`fromValue` are
// already resolved, human-readable display strings (see services/ticketActivity.js).
function describeTicketAction(action, fromValue, toValue, buckets) {
  if (action === 'created') return { colorKey: 'created', verb: 'opened' };
  if (action === 'comment') return { colorKey: 'comment', verb: 'replied on' };
  if (action === 'priority') return { colorKey: 'priority', verb: 'changed priority of', suffix: toValue ? `to ${toValue}` : null };
  if (action === 'assigneeId') {
    return toValue
      ? { colorKey: 'assigned', verb: 'assigned', suffix: `to ${toValue}` }
      : { colorKey: 'assigned', verb: 'unassigned' };
  }
  if (action === 'status') {
    if (isClosedStatusName(toValue, buckets)) return { colorKey: 'closed', verb: 'closed' };
    return { colorKey: 'status', verb: 'changed', suffix: toValue ? `to ${toValue}` : null };
  }
  return { colorKey: 'status', verb: 'updated' };
}

function describeProjectAction(action, detail) {
  if (action === 'project_created') return { colorKey: 'created', verb: 'created project' };
  if (action === 'status_changed') return { colorKey: 'status', verb: 'changed', suffix: detail?.to ? `to ${detail.to}` : null };
  if (action === 'task_closed') return { colorKey: 'closed', verb: `completed task "${detail?.title || 'task'}" on` };
  return { colorKey: 'status', verb: 'updated' };
}

// Collapses consecutive events (already sorted newest-first) by the same
// user, on the same target, of the same action, when each is within 5
// minutes of the previous one kept in the run — a chain of rapid edits (each
// gap <=5min) collapses into a single entry even if the first-to-last span
// exceeds 5 minutes, matching "duplicate consecutive events... within 5
// minutes" rather than a fixed rolling window anchored to the first event.
function groupEvents(events) {
  const groups = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    const sameBucket = last
      && last.userId === ev.userId
      && last.targetType === ev.targetType
      && last.targetId === ev.targetId
      && last.action === ev.action
      && Math.abs(new Date(last.chainAt) - new Date(ev.occurredAt)) <= GROUP_WINDOW_MS;
    if (sameBucket) {
      last.count += 1;
      last.chainAt = ev.occurredAt;
    } else {
      groups.push({ ...ev, count: 1, chainAt: ev.occurredAt });
    }
  }
  return groups.map(({ chainAt, ...rest }) => rest);
}

// Recent, meaningful events across tickets and projects, newest first, with
// rapid repeated actions collapsed (see groupEvents). `ticketWhere`/
// `projectWhere` (default: no filter) narrow both to a department for the
// department-manager dashboard. Fetches a wider window than `limit` since
// grouping only shrinks the result, then paginates over the grouped list.
async function activityFeed(buckets, ticketWhere = {}, projectWhere = {}, { limit = 20, offset = 0 } = {}) {
  const fetchLimit = (limit + offset) * 3 + 30;

  let ticketIdSet = null;
  if (Object.keys(ticketWhere).length > 0) {
    const rows = await Ticket.findAll({ where: ticketWhere, attributes: ['id'], raw: true });
    ticketIdSet = new Set(rows.map((r) => r.id));
  }
  let projectIdSet = null;
  if (Object.keys(projectWhere).length > 0) {
    const rows = await Project.findAll({ where: projectWhere, attributes: ['id'], raw: true });
    projectIdSet = new Set(rows.map((r) => r.id));
  }

  const ticketActWhere = { action: { [Op.in]: MEANINGFUL_TICKET_ACTIONS } };
  if (ticketIdSet) ticketActWhere.ticketId = { [Op.in]: [...ticketIdSet] };
  const projectActWhere = { action: { [Op.in]: MEANINGFUL_PROJECT_ACTIONS } };
  if (projectIdSet) projectActWhere.projectId = { [Op.in]: [...projectIdSet] };

  const [ticketActs, projectActs] = await Promise.all([
    TicketActivity.findAll({
      where: ticketActWhere,
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName'] },
        { model: Ticket, as: 'ticket', attributes: ['id', 'title'] },
      ],
      // `id DESC` breaks ties deterministically — MariaDB's DATETIME here has
      // only second precision, so several activity rows from a rapid burst
      // of edits (e.g. two PATCHes in the same request-handling second) can
      // share an identical createdAt, making createdAt-only DESC ordering
      // (and therefore the grouping logic that walks this order) unstable.
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: fetchLimit,
    }),
    ProjectActivity.findAll({
      where: projectActWhere,
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName'] },
        { model: Project, as: 'project', attributes: ['id', 'name', 'projectCode'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: fetchLimit,
    }),
  ]);

  const fromTickets = ticketActs
    .filter((a) => a.ticket)
    .map((a) => {
      const { colorKey, verb, suffix } = describeTicketAction(a.action, a.fromValue, a.toValue, buckets);
      return {
        id: `ticket-${a.id}`,
        userId: a.userId,
        actorName: a.user?.displayName || 'System',
        colorKey,
        verb,
        suffix: suffix || null,
        targetType: 'ticket',
        targetId: a.ticket.id,
        targetLabel: `#${String(a.ticket.id).padStart(5, '0')} ${a.ticket.title}`,
        action: a.action,
        occurredAt: a.createdAt,
      };
    });

  const fromProjects = projectActs
    .filter((a) => a.project)
    .map((a) => {
      const { colorKey, verb, suffix } = describeProjectAction(a.action, a.detail);
      return {
        id: `project-${a.id}`,
        userId: a.userId,
        actorName: a.user?.displayName || 'System',
        colorKey,
        verb,
        suffix: suffix || null,
        targetType: 'project',
        targetId: a.project.id,
        targetLabel: `${a.project.projectCode} ${a.project.name}`,
        action: a.action,
        occurredAt: a.createdAt,
      };
    });

  const merged = [...fromTickets, ...fromProjects].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const grouped = groupEvents(merged);
  return {
    events: grouped.slice(offset, offset + limit),
    hasMore: grouped.length > offset + limit,
  };
}

// GET /dashboard?userId= — everything the dashboard page needs in one round
// trip. Modes:
//   admin_system     — tickets.view_all or projects.view_all, no userId:
//                      system-wide stats/workload/activity
//   admin_department — tickets.view_department or projects.view_department
//                      (but not view_all), no userId: same shape as
//                      admin_system but narrowed to the caller's department
//   admin_filtered   — either of the above, userId given: that user's
//                      tech-mode dashboard (department viewers may only
//                      target users in their own department)
//   tech             — neither: the logged-in user's own dashboard
const get = asyncHandler(async (req, res) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId, 10) : null;

  const [canViewAllTickets, canViewAllProjects, canViewDeptTickets, canViewDeptProjects] = await Promise.all([
    hasPermission(req.user.id, 'tickets.view_all'),
    hasPermission(req.user.id, 'projects.view_all'),
    hasPermission(req.user.id, 'tickets.view_department'),
    hasPermission(req.user.id, 'projects.view_department'),
  ]);
  const isSystemView = canViewAllTickets || canViewAllProjects;
  const isDepartmentView = !isSystemView && (canViewDeptTickets || canViewDeptProjects);

  if (requestedUserId && !isSystemView && !isDepartmentView) {
    throw new ApiError(403, "You don't have permission to view another user's dashboard", 'FORBIDDEN');
  }

  // Fetched once per request and threaded through every stat below, so a
  // custom or renamed status is reflected immediately with no extra queries.
  const buckets = await getTicketStatusBuckets();
  const behaviorByName = new Map();
  buckets.open.forEach((name) => behaviorByName.set(name, 'open'));
  buckets.closed.forEach((name) => behaviorByName.set(name, 'closed'));
  buckets.archived.forEach((name) => behaviorByName.set(name, 'archived'));

  if (requestedUserId && isDepartmentView) {
    const targetCheck = await User.findByPk(requestedUserId, { attributes: ['id', 'departmentId'] });
    if (!targetCheck || targetCheck.departmentId !== req.user.departmentId) {
      throw new ApiError(403, 'You can only view dashboards for users in your department', 'FORBIDDEN');
    }
  }

  if (isSystemView && !requestedUserId) {
    const [stats, projectHealth, workload, activity] = await Promise.all([
      systemStats(buckets),
      projectHealthFor({}),
      teamWorkload(buckets),
      activityFeed(buckets, {}, {}),
    ]);
    return res.json({
      mode: 'admin_system',
      viewingUser: null,
      stats,
      projectHealth,
      teamWorkload: workload,
      activity: activity.events,
      activityHasMore: activity.hasMore,
    });
  }

  if (isDepartmentView && !requestedUserId) {
    const deptId = req.user.departmentId;
    const deptProjectWhere = { [Op.or]: [{ ownerDepartmentId: deptId }, { forDepartmentId: deptId }] };
    const [stats, projectHealth, workload, activity] = await Promise.all([
      systemStats(buckets, { departmentId: deptId }),
      projectHealthFor(deptProjectWhere),
      teamWorkload(buckets, { departmentId: deptId }),
      activityFeed(buckets, { departmentId: deptId }, deptProjectWhere),
    ]);
    return res.json({
      mode: 'admin_department',
      viewingUser: null,
      stats,
      projectHealth,
      teamWorkload: workload,
      activity: activity.events,
      activityHasMore: activity.hasMore,
    });
  }

  const targetId = requestedUserId || req.user.id;
  const targetUser = requestedUserId ? await User.findByPk(targetId) : req.user;
  if (!targetUser) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  // Every PRISM user is staff now — "my work" is always what's assigned to me.
  const scopeField = 'assigneeId';

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

// GET /dashboard/activity?offset= — "Load more" pagination for the activity
// feed panel, reusing the same system/department scope rules as GET /dashboard.
const activityMore = asyncHandler(async (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  const [canViewAllTickets, canViewAllProjects, canViewDeptTickets, canViewDeptProjects] = await Promise.all([
    hasPermission(req.user.id, 'tickets.view_all'),
    hasPermission(req.user.id, 'projects.view_all'),
    hasPermission(req.user.id, 'tickets.view_department'),
    hasPermission(req.user.id, 'projects.view_department'),
  ]);
  const isSystemView = canViewAllTickets || canViewAllProjects;
  const isDepartmentView = !isSystemView && (canViewDeptTickets || canViewDeptProjects);
  if (!isSystemView && !isDepartmentView) {
    throw new ApiError(403, "You don't have permission to view the activity feed", 'FORBIDDEN');
  }

  const buckets = await getTicketStatusBuckets();
  let activity;
  if (isSystemView) {
    activity = await activityFeed(buckets, {}, {}, { offset });
  } else {
    const deptId = req.user.departmentId;
    const deptProjectWhere = { [Op.or]: [{ ownerDepartmentId: deptId }, { forDepartmentId: deptId }] };
    activity = await activityFeed(buckets, { departmentId: deptId }, deptProjectWhere, { offset });
  }
  res.json({ activity: activity.events, activityHasMore: activity.hasMore });
});

// GET /dashboard/layout — the caller's saved dashboard panel layout, or null
// if they haven't customized it (frontend falls back to the default layout).
const getLayout = asyncHandler(async (req, res) => {
  const row = await DashboardLayout.findOne({ where: { userId: req.user.id } });
  res.json({ layout: row ? row.layout : null });
});

// PUT /dashboard/layout { layout } — upserts the caller's layout. `layout` is
// an opaque JSON blob owned entirely by the frontend (panel order/sizes/hidden).
const saveLayout = asyncHandler(async (req, res) => {
  const { layout } = req.body || {};
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new ApiError(400, 'layout must be an object', 'VALIDATION_ERROR');
  }
  const [row, created] = await DashboardLayout.findOrCreate({ where: { userId: req.user.id }, defaults: { layout } });
  if (!created) {
    row.layout = layout;
    await row.save();
  }
  res.json({ layout: row.layout });
});

// DELETE /dashboard/layout — "Reset to default": removes the saved
// customization so the frontend's built-in default layout applies again.
const resetLayout = asyncHandler(async (req, res) => {
  await DashboardLayout.destroy({ where: { userId: req.user.id } });
  res.json({ ok: true });
});

module.exports = { get, activityMore, getLayout, saveLayout, resetLayout };
