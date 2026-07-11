const { Op, fn, col } = require('sequelize');
const {
  Ticket, TimeEntry, ProjectTimeEntry, User, Team, TeamMember, Project, ProjectMember,
  ProjectExpense, ProjectMaterial, Department, Contact, Comment, CsatResponse, sequelize,
} = require('../models');
const { asyncHandler, ApiError } = require('../middleware/error');
const { getUserReportScope } = require('../services/permissionService');
const { getTicketStatusBuckets, getProjectStatusBuckets } = require('../services/statusBehavior');
const { computeProjectCompletion } = require('../services/projectCompletion');

// ==================== Shared helpers ====================

function parseDateRange(query) {
  let start = null;
  let end = null;
  if (query.startDate) {
    const d = new Date(query.startDate);
    if (!Number.isNaN(d.getTime())) start = d;
  }
  if (query.endDate) {
    const d = new Date(query.endDate);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      end = d;
    }
  }
  return { start, end };
}

function dateWhere(field, range) {
  const clause = {};
  if (range.start) clause[Op.gte] = range.start;
  if (range.end) clause[Op.lte] = range.end;
  // Op.gte/Op.lte are Symbol keys — Object.keys() can't see them.
  return Object.getOwnPropertySymbols(clause).length ? { [field]: clause } : {};
}

function parseDepartmentId(query) {
  const id = parseInt(query.departmentId, 10);
  return Number.isFinite(id) ? id : null;
}
function parseAssigneeId(query) {
  const id = parseInt(query.assigneeId, 10);
  return Number.isFinite(id) ? id : null;
}

// Auto-granularity for time-series charts: daily under a month, weekly under
// ~6 months, monthly beyond that.
function granularityFor(range) {
  if (!range.start || !range.end) return 'day';
  const days = (range.end.getTime() - range.start.getTime()) / 86400000;
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

// Monday-anchored ISO week start, used as the bucket key for 'week' granularity.
function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function bucketKey(date, granularity) {
  const d = new Date(date);
  if (granularity === 'month') return d.toISOString().slice(0, 7);
  if (granularity === 'week') return weekStart(d).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Ticket scope, keyed off reports.view_own/department/all (not tickets.*) —
// this module's own permission family, since a report can span domains.
function ticketScopeWhere(where, scope, user, requestedDepartmentId) {
  if (scope === 'all') {
    return requestedDepartmentId ? { ...where, departmentId: requestedDepartmentId } : where;
  }
  if (scope === 'department') {
    return { ...where, [Op.and]: [{ [Op.or]: [{ departmentId: user.departmentId }, { assigneeId: user.id }] }] };
  }
  return { ...where, assigneeId: user.id };
}

function projectScopeWhere(where, scope, user, requestedDepartmentId) {
  if (scope === 'all') {
    return requestedDepartmentId
      ? { ...where, [Op.or]: [{ ownerDepartmentId: requestedDepartmentId }, { forDepartmentId: requestedDepartmentId }] }
      : where;
  }
  if (scope === 'department') {
    return { ...where, [Op.or]: [{ ownerDepartmentId: user.departmentId }, { forDepartmentId: user.departmentId }] };
  }
  return { ...where, assignedToUserId: user.id };
}

function contactDeptWhere(where, scope, user, requestedDepartmentId) {
  if (scope === 'all') {
    return requestedDepartmentId ? { ...where, departmentId: requestedDepartmentId } : where;
  }
  return { ...where, departmentId: user.departmentId };
}

// Quote a CSV cell if it contains a comma, quote, or newline.
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sendCsv(res, filename, columns, rows) {
  const header = columns.map((c) => c.label);
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])));
  const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="prism-${filename}.csv"`);
  res.send(csv);
}

function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

const userAttrs = ['id', 'displayName', 'username'];

// ==================== Report 1: Ticket Volume ====================

async function buildTicketVolumeReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const assigneeId = parseAssigneeId(req.query);

  let where = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId);
  if (assigneeId) where.assigneeId = assigneeId;

  const tickets = await Ticket.findAll({
    where,
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });

  // "Currently open" is a live snapshot, not bound to the date range —
  // otherwise a ticket created last quarter and still open wouldn't count.
  let openNowWhere = ticketScopeWhere({}, scope, req.user, deptId);
  if (assigneeId) openNowWhere.assigneeId = assigneeId;
  const buckets = await getTicketStatusBuckets();
  const currentlyOpen = await Ticket.count({ where: { ...openNowWhere, status: { [Op.in]: buckets.open } } });

  const closed = tickets.filter((t) => t.resolvedAt);
  const totalResolutionHours = closed.reduce((sum, t) => sum + hoursBetween(t.createdAt, t.resolvedAt), 0);
  const avgResolutionHours = closed.length ? totalResolutionHours / closed.length : null;

  const granularity = granularityFor(range);
  const createdByBucket = new Map();
  tickets.forEach((t) => {
    const key = bucketKey(t.createdAt, granularity);
    createdByBucket.set(key, (createdByBucket.get(key) || 0) + 1);
  });
  const volumeOverTime = [...createdByBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

  const countBy = (key) => {
    const m = new Map();
    tickets.forEach((t) => { const k = t[key] || 'unknown'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([name, count]) => ({ name, count }));
  };

  return {
    summary: {
      totalCreated: tickets.length,
      totalClosed: closed.length,
      currentlyOpen,
      avgResolutionHours,
    },
    chartData: {
      granularity,
      volumeOverTime,
      byStatus: countBy('status'),
      byType: countBy('type'),
      byPriority: countBy('priority'),
    },
    tableData: {
      columns: [
        { key: 'ticketNumber', label: 'Ticket #' },
        { key: 'title', label: 'Title' },
        { key: 'type', label: 'Type' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'createdAt', label: 'Created' },
        { key: 'resolvedAt', label: 'Closed' },
        { key: 'resolutionHours', label: 'Resolution (hrs)' },
        { key: 'assignee', label: 'Assignee' },
      ],
      rows: tickets.map((t) => ({
        id: t.id,
        ticketNumber: String(t.id).padStart(5, '0'),
        title: t.title,
        type: t.type,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt.toISOString().slice(0, 10),
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString().slice(0, 10) : '',
        resolutionHours: t.resolvedAt ? Math.round(hoursBetween(t.createdAt, t.resolvedAt) * 10) / 10 : '',
        assignee: t.assignee?.displayName || 'Unassigned',
      })),
    },
  };
}

const ticketVolume = asyncHandler(async (req, res) => res.json(await buildTicketVolumeReport(req)));
const ticketVolumeExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildTicketVolumeReport(req);
  sendCsv(res, 'ticket-volume', tableData.columns, tableData.rows);
});

// ==================== Report 2: Ticket Trends ====================

async function buildTicketTrendsReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const granularity = granularityFor(range) === 'day' ? 'week' : granularityFor(range); // trends read better weekly minimum

  const createdWhere = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId);
  const closedWhere = ticketScopeWhere(dateWhere('resolvedAt', range), scope, req.user, deptId);

  const [createdTickets, closedTickets] = await Promise.all([
    Ticket.findAll({ where: createdWhere, attributes: ['id', 'createdAt'] }),
    Ticket.findAll({ where: closedWhere, attributes: ['id', 'resolvedAt'] }),
  ]);

  const createdByBucket = new Map();
  createdTickets.forEach((t) => {
    const k = bucketKey(t.createdAt, granularity);
    createdByBucket.set(k, (createdByBucket.get(k) || 0) + 1);
  });
  const closedByBucket = new Map();
  closedTickets.forEach((t) => {
    const k = bucketKey(t.resolvedAt, granularity);
    closedByBucket.set(k, (closedByBucket.get(k) || 0) + 1);
  });
  const allKeys = [...new Set([...createdByBucket.keys(), ...closedByBucket.keys()])].sort((a, b) => a.localeCompare(b));
  let runningBacklog = 0;
  const createdVsClosed = allKeys.map((date) => {
    const created = createdByBucket.get(date) || 0;
    const closedCount = closedByBucket.get(date) || 0;
    runningBacklog += created - closedCount;
    return { date, created, closed: closedCount };
  });
  const backlogOverTime = createdVsClosed.map((r) => ({ date: r.date }));
  let running = 0;
  createdVsClosed.forEach((r, i) => {
    running += r.created - r.closed;
    backlogOverTime[i].backlog = Math.max(0, running);
  });

  const byDepartment = await Ticket.findAll({
    where: createdWhere,
    attributes: [[fn('COUNT', col('Ticket.id')), 'count']],
    include: [{
      model: Contact, as: 'contact', attributes: [],
      include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
    }],
    group: ['contact.department.id'],
    raw: true,
    nest: true,
  });

  const dayOfWeekCounts = Array(7).fill(0);
  const hourOfDayCounts = Array(24).fill(0);
  createdTickets.forEach((t) => {
    const d = new Date(t.createdAt);
    dayOfWeekCounts[d.getDay()] += 1;
    hourOfDayCounts[d.getHours()] += 1;
  });
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    summary: {
      totalCreated: createdTickets.length,
      totalClosed: closedTickets.length,
      currentBacklog: backlogOverTime.length ? backlogOverTime[backlogOverTime.length - 1].backlog : 0,
    },
    chartData: {
      granularity,
      createdVsClosed,
      backlogOverTime,
      byDepartment: byDepartment.map((r) => ({ name: r.contact?.department?.name || 'No department', count: Number(r.count) })),
      byDayOfWeek: DAY_NAMES.map((name, i) => ({ name, count: dayOfWeekCounts[i] })),
      byHourOfDay: hourOfDayCounts.map((count, hour) => ({ name: `${hour}:00`, count })),
    },
    tableData: { columns: [], rows: [] },
  };
}

const ticketTrends = asyncHandler(async (req, res) => res.json(await buildTicketTrendsReport(req)));
const ticketTrendsExport = asyncHandler(async (req, res) => {
  const { chartData } = await buildTicketTrendsReport(req);
  sendCsv(
    res, 'ticket-trends',
    [{ key: 'date', label: 'Date' }, { key: 'created', label: 'Created' }, { key: 'closed', label: 'Closed' }],
    chartData.createdVsClosed
  );
});

// ==================== Report 3: Team Performance ====================

async function buildTeamPerformanceReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const userWhere = { role: { [Op.in]: ['admin', 'technician'] }, isActive: true };
  if (scope === 'all') {
    if (deptId) userWhere.departmentId = deptId;
  } else if (scope === 'department') {
    userWhere.departmentId = req.user.departmentId;
  } else {
    userWhere.id = req.user.id;
  }
  const techs = await User.findAll({
    where: userWhere,
    attributes: [...userAttrs, 'departmentId'],
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  });
  const techIds = techs.map((t) => t.id);

  const emptyResult = {
    summary: { techCount: techs.length, totalClosed: 0, avgResolutionHours: null },
    chartData: { closedPerTech: [], avgResolutionPerTech: [], workloadPerTech: [] },
    tableData: { columns: teamPerformanceColumns(), rows: [] },
  };
  if (!techIds.length) return emptyResult;

  const buckets = await getTicketStatusBuckets();
  const todayStr = new Date().toISOString().slice(0, 10);

  const [assignedTickets, closedTickets, workloadCounts, timeEntries] = await Promise.all([
    Ticket.findAll({ where: { assigneeId: { [Op.in]: techIds }, ...dateWhere('createdAt', range) }, attributes: ['id', 'assigneeId', 'createdAt'], raw: true }),
    Ticket.findAll({ where: { assigneeId: { [Op.in]: techIds }, resolvedAt: { [Op.ne]: null }, ...dateWhere('resolvedAt', range) }, attributes: ['id', 'assigneeId', 'createdAt', 'resolvedAt'], raw: true }),
    Ticket.findAll({ where: { assigneeId: { [Op.in]: techIds }, status: { [Op.in]: buckets.open } }, attributes: ['assigneeId', [fn('COUNT', col('id')), 'count']], group: ['assigneeId'], raw: true }),
    TimeEntry.findAll({ where: { userId: { [Op.in]: techIds }, ...dateWhere('loggedAt', range) }, attributes: ['userId', [fn('SUM', col('minutes')), 'minutes']], group: ['userId'], raw: true }),
  ]);
  const overdueCounts = await Ticket.findAll({
    where: { assigneeId: { [Op.in]: techIds }, status: { [Op.in]: buckets.open }, dueDate: { [Op.ne]: null, [Op.lt]: todayStr } },
    attributes: ['assigneeId', [fn('COUNT', col('id')), 'count']],
    group: ['assigneeId'],
    raw: true,
  });

  const ticketIds = assignedTickets.map((t) => t.id);
  const firstReplies = ticketIds.length
    ? await Comment.findAll({
        where: { ticketId: { [Op.in]: ticketIds }, type: 'reply' },
        attributes: ['ticketId', [fn('MIN', col('createdAt')), 'firstReplyAt']],
        group: ['ticketId'],
        raw: true,
      })
    : [];
  const firstReplyByTicket = new Map(firstReplies.map((r) => [r.ticketId, r.firstReplyAt]));

  const assignedByTech = new Map();
  assignedTickets.forEach((t) => assignedByTech.set(t.assigneeId, (assignedByTech.get(t.assigneeId) || 0) + 1));

  const closedByTech = new Map();
  closedTickets.forEach((t) => {
    const cur = closedByTech.get(t.assigneeId) || { count: 0, totalHours: 0 };
    cur.count += 1;
    cur.totalHours += hoursBetween(t.createdAt, t.resolvedAt);
    closedByTech.set(t.assigneeId, cur);
  });

  const responseByTech = new Map();
  assignedTickets.forEach((t) => {
    const replyAt = firstReplyByTicket.get(t.id);
    if (!replyAt) return;
    const cur = responseByTech.get(t.assigneeId) || { sumHours: 0, count: 0 };
    cur.sumHours += hoursBetween(t.createdAt, replyAt);
    cur.count += 1;
    responseByTech.set(t.assigneeId, cur);
  });

  const overdueByTech = new Map(overdueCounts.map((r) => [r.assigneeId, Number(r.count)]));
  const workloadByTech = new Map(workloadCounts.map((r) => [r.assigneeId, Number(r.count)]));
  const timeByTech = new Map(timeEntries.map((r) => [r.userId, Number(r.minutes) || 0]));

  const rows = techs.map((tech) => {
    const closed = closedByTech.get(tech.id) || { count: 0, totalHours: 0 };
    const resp = responseByTech.get(tech.id) || { sumHours: 0, count: 0 };
    return {
      id: tech.id,
      name: tech.displayName,
      department: tech.department?.name || '—',
      assigned: assignedByTech.get(tech.id) || 0,
      closed: closed.count,
      overdue: overdueByTech.get(tech.id) || 0,
      avgResolutionHours: closed.count ? Math.round((closed.totalHours / closed.count) * 10) / 10 : null,
      workload: workloadByTech.get(tech.id) || 0,
      totalHoursLogged: Math.round(((timeByTech.get(tech.id) || 0) / 60) * 10) / 10,
      avgFirstResponseHours: resp.count ? Math.round((resp.sumHours / resp.count) * 10) / 10 : null,
    };
  });

  const totalClosed = rows.reduce((sum, r) => sum + r.closed, 0);
  const resolutionRows = rows.filter((r) => r.avgResolutionHours !== null);
  const avgResolutionHours = resolutionRows.length
    ? resolutionRows.reduce((sum, r) => sum + r.avgResolutionHours, 0) / resolutionRows.length
    : null;

  return {
    summary: { techCount: techs.length, totalClosed, avgResolutionHours },
    chartData: {
      closedPerTech: rows.map((r) => ({ name: r.name, count: r.closed })),
      avgResolutionPerTech: rows.map((r) => ({ name: r.name, hours: r.avgResolutionHours || 0 })),
      workloadPerTech: rows.map((r) => ({ name: r.name, count: r.workload })),
    },
    tableData: { columns: teamPerformanceColumns(), rows },
  };
}

function teamPerformanceColumns() {
  return [
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'closed', label: 'Closed' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'avgResolutionHours', label: 'Avg resolution (hrs)' },
    { key: 'totalHoursLogged', label: 'Time logged (hrs)' },
    { key: 'avgFirstResponseHours', label: 'Avg first response (hrs)' },
  ];
}

const teamPerformance = asyncHandler(async (req, res) => res.json(await buildTeamPerformanceReport(req)));
const teamPerformanceExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildTeamPerformanceReport(req);
  sendCsv(res, 'team-performance', tableData.columns, tableData.rows);
});

// ==================== Report 4: SLA Compliance ====================

async function buildSlaComplianceReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const closedWithDueDate = await Ticket.findAll({
    where: ticketScopeWhere({ resolvedAt: { [Op.ne]: null }, dueDate: { [Op.ne]: null }, ...dateWhere('resolvedAt', range) }, scope, req.user, deptId),
    attributes: ['id', 'title', 'dueDate', 'resolvedAt', 'assigneeId', 'departmentId'],
    include: [
      { model: User, as: 'assignee', attributes: userAttrs },
      { model: Department, as: 'department', attributes: ['id', 'name'] },
    ],
  });

  const met = [];
  const missed = [];
  closedWithDueDate.forEach((t) => {
    const dueEnd = new Date(`${t.dueDate}T23:59:59`);
    (t.resolvedAt <= dueEnd ? met : missed).push(t);
  });

  const buckets = await getTicketStatusBuckets();
  const todayStr = new Date().toISOString().slice(0, 10);
  const openWhere = ticketScopeWhere({ status: { [Op.in]: buckets.open } }, scope, req.user, deptId);
  const [openTotal, openOverdue] = await Promise.all([
    Ticket.count({ where: openWhere }),
    Ticket.count({ where: { ...openWhere, dueDate: { [Op.ne]: null, [Op.lt]: todayStr } } }),
  ]);

  const byTech = new Map();
  const byDept = new Map();
  const bumpBucket = (map, key, label, isMet) => {
    const cur = map.get(key) || { name: label, met: 0, missed: 0 };
    if (isMet) cur.met += 1; else cur.missed += 1;
    map.set(key, cur);
  };
  closedWithDueDate.forEach((t) => {
    const isMet = met.includes(t);
    bumpBucket(byTech, t.assigneeId || 'unassigned', t.assignee?.displayName || 'Unassigned', isMet);
    bumpBucket(byDept, t.departmentId || 'none', t.department?.name || 'No department', isMet);
  });

  const granularity = granularityFor(range) === 'day' ? 'week' : granularityFor(range);
  const trendMap = new Map();
  closedWithDueDate.forEach((t) => {
    const key = bucketKey(t.resolvedAt, granularity);
    const cur = trendMap.get(key) || { date: key, met: 0, missed: 0 };
    if (met.includes(t)) cur.met += 1; else cur.missed += 1;
    trendMap.set(key, cur);
  });
  const complianceTrend = [...trendMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, pctMet: r.met + r.missed ? Math.round((100 * r.met) / (r.met + r.missed)) : null }));

  const totalClosedWithDueDate = met.length + missed.length;

  return {
    summary: {
      pctMetSLA: totalClosedWithDueDate ? Math.round((100 * met.length) / totalClosedWithDueDate) : null,
      pctMissedAtClosing: totalClosedWithDueDate ? Math.round((100 * missed.length) / totalClosedWithDueDate) : null,
      pctCurrentlyOverdue: openTotal ? Math.round((100 * openOverdue) / openTotal) : null,
    },
    chartData: {
      metVsMissedByTech: [...byTech.values()],
      metVsMissedByDept: [...byDept.values()],
      complianceTrend,
    },
    tableData: {
      columns: [
        { key: 'ticketNumber', label: 'Ticket #' },
        { key: 'title', label: 'Title' },
        { key: 'assignee', label: 'Assignee' },
        { key: 'dueDate', label: 'Due date' },
        { key: 'closedDate', label: 'Closed date' },
        { key: 'daysOverdue', label: 'Days overdue' },
      ],
      rows: missed.map((t) => ({
        id: t.id,
        ticketNumber: String(t.id).padStart(5, '0'),
        title: t.title,
        assignee: t.assignee?.displayName || 'Unassigned',
        dueDate: t.dueDate,
        closedDate: t.resolvedAt.toISOString().slice(0, 10),
        daysOverdue: Math.round(hoursBetween(`${t.dueDate}T23:59:59`, t.resolvedAt) / 24 * 10) / 10,
      })),
    },
  };
}

const slaCompliance = asyncHandler(async (req, res) => res.json(await buildSlaComplianceReport(req)));
const slaComplianceExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildSlaComplianceReport(req);
  sendCsv(res, 'sla-compliance', tableData.columns, tableData.rows);
});

// ==================== Report 5: Time & Billing ====================

async function buildTimeBillingReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const assigneeId = parseAssigneeId(req.query);

  let ticketWhere = dateWhere('loggedAt', range);
  let projectWhere = dateWhere('createdAt', range);
  if (scope === 'department') {
    ticketWhere = { ...ticketWhere, '$ticket.departmentId$': req.user.departmentId };
    projectWhere = { ...projectWhere, '$project.ownerDepartmentId$': req.user.departmentId };
  } else if (scope === 'own') {
    ticketWhere = { ...ticketWhere, userId: req.user.id };
    projectWhere = { ...projectWhere, loggedForUserId: req.user.id };
  } else if (scope === 'all' && deptId) {
    ticketWhere = { ...ticketWhere, '$ticket.departmentId$': deptId };
    projectWhere = { ...projectWhere, '$project.ownerDepartmentId$': deptId };
  }
  if (assigneeId) {
    ticketWhere = { ...ticketWhere, userId: assigneeId };
    projectWhere = { ...projectWhere, loggedForUserId: assigneeId };
  }

  const [ticketEntries, projectEntries] = await Promise.all([
    TimeEntry.findAll({
      where: ticketWhere,
      include: [
        { model: User, as: 'user', attributes: userAttrs },
        {
          model: Ticket, as: 'ticket', attributes: ['id', 'title', 'type', 'departmentId'],
          include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
        },
      ],
      order: [['loggedAt', 'DESC']],
    }),
    ProjectTimeEntry.findAll({
      where: projectWhere,
      include: [
        { model: User, as: 'loggedFor', attributes: userAttrs },
        {
          model: Project, as: 'project', attributes: ['id', 'name'],
          include: [{ model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
    }),
  ]);

  const normalized = [
    ...ticketEntries.map((e) => ({
      date: e.loggedAt, user: e.user, minutes: e.minutes, isProject: false, ticketType: e.ticket?.type || null,
      reference: e.ticket ? `#${String(e.ticket.id).padStart(5, '0')} ${e.ticket.title}` : '',
      department: e.ticket?.department || null, note: e.note, laborCost: e.laborCost,
    })),
    ...projectEntries.map((e) => ({
      date: e.createdAt, user: e.loggedFor, minutes: Math.max(1, Math.round((e.durationSeconds || 0) / 60)), isProject: true, ticketType: null,
      reference: e.project ? `Project: ${e.project.name}` : 'Project',
      department: e.project?.ownerDepartment || null, note: e.description, laborCost: e.laborCost,
    })),
  ];

  const granularity = granularityFor(range);
  const byTech = new Map();
  const byDept = new Map();
  const byType = new Map();
  const byBucket = new Map();
  let totalMinutes = 0;
  let ticketMinutes = 0;
  let contractorMinutes = 0;
  let totalLaborCost = 0;
  const ticketRefSet = new Set();

  const bumpMinutes = (map, key, label, minutes) => {
    const cur = map.get(key) || { name: label, minutes: 0 };
    cur.minutes += minutes;
    map.set(key, cur);
  };

  normalized.forEach((e) => {
    totalMinutes += e.minutes;
    bumpMinutes(byTech, e.user ? e.user.id : 'unknown', e.user ? e.user.displayName : 'Unknown', e.minutes);
    bumpMinutes(byDept, e.department ? e.department.id : 'none', e.department ? e.department.name : 'Unassigned', e.minutes);
    bumpMinutes(byType, e.ticketType || 'project', e.ticketType || 'Project work', e.minutes);
    const bk = bucketKey(e.date, granularity);
    const cur = byBucket.get(bk) || { date: bk, minutes: 0 };
    cur.minutes += e.minutes;
    byBucket.set(bk, cur);
    if (!e.isProject) {
      ticketMinutes += e.minutes;
      ticketRefSet.add(e.reference);
    }
    if (e.laborCost != null) {
      contractorMinutes += e.minutes;
      totalLaborCost += Number(e.laborCost);
    }
  });

  const toHours = (m) => Math.round((m / 60) * 10) / 10;

  return {
    summary: {
      totalHours: toHours(totalMinutes),
      avgHoursPerTicket: ticketRefSet.size ? Math.round((toHours(ticketMinutes) / ticketRefSet.size) * 10) / 10 : 0,
      entryCount: normalized.length,
      internalHours: toHours(totalMinutes - contractorMinutes),
      contractorHours: toHours(contractorMinutes),
      totalLaborCost: Math.round(totalLaborCost * 100) / 100,
    },
    chartData: {
      granularity,
      byTech: [...byTech.values()].map((r) => ({ name: r.name, hours: toHours(r.minutes) })).sort((a, b) => b.hours - a.hours),
      byDepartment: [...byDept.values()].map((r) => ({ name: r.name, hours: toHours(r.minutes) })).sort((a, b) => b.hours - a.hours),
      byType: [...byType.values()].map((r) => ({ name: r.name, hours: toHours(r.minutes) })),
      overTime: [...byBucket.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, hours: toHours(r.minutes) })),
    },
    tableData: {
      columns: [
        { key: 'techName', label: 'Tech' },
        { key: 'reference', label: 'Ticket/Project' },
        { key: 'note', label: 'Description' },
        { key: 'date', label: 'Date' },
        { key: 'hours', label: 'Hours' },
        { key: 'laborCost', label: 'Labor cost' },
      ],
      rows: normalized.map((e, i) => ({
        id: i,
        techName: e.user?.displayName || 'Unknown',
        reference: e.reference,
        note: e.note || '',
        date: e.date ? new Date(e.date).toISOString().slice(0, 10) : '',
        hours: toHours(e.minutes),
        laborCost: e.laborCost != null ? Number(e.laborCost) : '',
      })),
    },
  };
}

const timeBilling = asyncHandler(async (req, res) => res.json(await buildTimeBillingReport(req)));
const timeBillingExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildTimeBillingReport(req);
  sendCsv(res, 'time-billing', tableData.columns, tableData.rows);
});

// ==================== Report 6: Projects ====================

async function buildProjectsReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const where = projectScopeWhere({}, scope, req.user, deptId);
  const projects = await Project.findAll({
    where,
    include: [
      { model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] },
      { model: Department, as: 'forDepartment', attributes: ['id', 'name'] },
    ],
    order: [['updatedAt', 'DESC']],
  });

  const statusBuckets = await getProjectStatusBuckets();
  const active = projects.filter((p) => statusBuckets.open.includes(p.status));
  const completedInPeriod = projects.filter(
    (p) => p.closedAt && (!range.start || p.closedAt >= range.start) && (!range.end || p.closedAt <= range.end)
  );

  const rows = [];
  let totalMaterialsCost = 0;
  let totalExpensesCost = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const p of projects) {
    // eslint-disable-next-line no-await-in-loop
    const [completion, timeSum, expenseSum, materialSum] = await Promise.all([
      computeProjectCompletion(p.id),
      ProjectTimeEntry.sum('durationSeconds', { where: { projectId: p.id } }),
      ProjectExpense.sum('amount', { where: { projectId: p.id } }),
      ProjectMaterial.sum('totalCost', { where: { projectId: p.id } }),
    ]);
    const materials = Number(materialSum) || 0;
    const expenses = Number(expenseSum) || 0;
    totalMaterialsCost += materials;
    totalExpensesCost += expenses;
    rows.push({
      id: p.id,
      projectCode: p.projectCode,
      name: p.name,
      ownedBy: p.ownerDepartment?.name || '—',
      forDept: p.forDepartment?.name || '—',
      status: p.status,
      completion: completion.percent,
      dueDate: p.dueDate || '',
      timeLoggedHours: Math.round(((Number(timeSum) || 0) / 3600) * 10) / 10,
      materialsCost: materials,
      expensesCost: expenses,
      totalCost: Math.round((materials + expenses) * 100) / 100,
    });
  }

  const byStatus = new Map();
  projects.forEach((p) => {
    const cur = byStatus.get(p.status) || { name: p.status, count: 0 };
    cur.count += 1;
    byStatus.set(p.status, cur);
  });

  const byDeptCost = new Map();
  rows.forEach((r) => {
    const cur = byDeptCost.get(r.forDept) || { name: r.forDept, cost: 0 };
    cur.cost += r.totalCost;
    byDeptCost.set(r.forDept, cur);
  });

  const completionDistribution = [
    { name: '0-25%', count: 0 }, { name: '26-50%', count: 0 }, { name: '51-75%', count: 0 }, { name: '76-100%', count: 0 },
  ];
  rows.forEach((r) => {
    if (r.completion <= 25) completionDistribution[0].count += 1;
    else if (r.completion <= 50) completionDistribution[1].count += 1;
    else if (r.completion <= 75) completionDistribution[2].count += 1;
    else completionDistribution[3].count += 1;
  });

  const avgCompletion = rows.length ? Math.round(rows.reduce((sum, r) => sum + r.completion, 0) / rows.length) : 0;

  return {
    summary: {
      totalActive: active.length,
      totalCompletedInPeriod: completedInPeriod.length,
      avgCompletion,
      totalMaterialsCost: Math.round(totalMaterialsCost * 100) / 100,
      totalExpensesCost: Math.round(totalExpensesCost * 100) / 100,
    },
    chartData: {
      byStatus: [...byStatus.values()],
      costByDepartment: [...byDeptCost.values()],
      completionDistribution,
    },
    tableData: {
      columns: [
        { key: 'projectCode', label: 'Project' },
        { key: 'name', label: 'Name' },
        { key: 'ownedBy', label: 'Owned by' },
        { key: 'forDept', label: 'For dept' },
        { key: 'status', label: 'Status' },
        { key: 'completion', label: 'Completion %' },
        { key: 'dueDate', label: 'Due date' },
        { key: 'timeLoggedHours', label: 'Time logged (hrs)' },
        { key: 'materialsCost', label: 'Materials cost' },
        { key: 'expensesCost', label: 'Expenses cost' },
        { key: 'totalCost', label: 'Total cost' },
      ],
      rows,
    },
  };
}

const projectsReport = asyncHandler(async (req, res) => res.json(await buildProjectsReport(req)));
const projectsReportExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildProjectsReport(req);
  sendCsv(res, 'projects', tableData.columns, tableData.rows);
});

// ==================== Report 7: Contacts ====================

async function buildContactsReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const contactWhere = contactDeptWhere({}, scope, req.user, deptId);
  const contacts = await Contact.findAll({
    where: contactWhere,
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const contactIds = contacts.map((c) => c.id);

  const buckets = await getTicketStatusBuckets();
  const tickets = contactIds.length
    ? await Ticket.findAll({
        where: { contactId: { [Op.in]: contactIds }, ...dateWhere('createdAt', range) },
        attributes: ['id', 'contactId', 'status', 'createdAt', 'resolvedAt'],
      })
    : [];

  const ticketsByContact = new Map();
  tickets.forEach((t) => {
    const cur = ticketsByContact.get(t.contactId) || [];
    cur.push(t);
    ticketsByContact.set(t.contactId, cur);
  });

  const contactsWithOpenTickets = contacts.filter((c) => (ticketsByContact.get(c.id) || []).some((t) => buckets.open.includes(t.status))).length;

  let mostActiveContact = null;
  contacts.forEach((c) => {
    const count = (ticketsByContact.get(c.id) || []).length;
    if (!mostActiveContact || count > mostActiveContact.count) mostActiveContact = { name: c.displayName, count };
  });

  const deptStats = new Map();
  contacts.forEach((c) => {
    const key = c.departmentId || 'none';
    const label = c.department?.name || 'No department';
    const cur = deptStats.get(key) || { name: label, totalContacts: 0, totalTickets: 0, openTickets: 0, closedTickets: 0, resolutionHoursSum: 0, resolutionCount: 0 };
    cur.totalContacts += 1;
    (ticketsByContact.get(c.id) || []).forEach((t) => {
      cur.totalTickets += 1;
      if (buckets.open.includes(t.status)) cur.openTickets += 1;
      if (t.resolvedAt) {
        cur.closedTickets += 1;
        cur.resolutionHoursSum += hoursBetween(t.createdAt, t.resolvedAt);
        cur.resolutionCount += 1;
      }
    });
    deptStats.set(key, cur);
  });

  const deptRows = [...deptStats.values()]
    .map((d) => ({
      name: d.name, totalContacts: d.totalContacts, totalTickets: d.totalTickets, openTickets: d.openTickets, closedTickets: d.closedTickets,
      avgResolutionHours: d.resolutionCount ? Math.round((d.resolutionHoursSum / d.resolutionCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.totalTickets - a.totalTickets);

  const topContacts = contacts
    .map((c) => ({ name: c.displayName, count: (ticketsByContact.get(c.id) || []).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const granularity = granularityFor(range) === 'day' ? 'week' : granularityFor(range);
  const submissionsByDeptOverTime = new Map();
  tickets.forEach((t) => {
    const deptName = contactById.get(t.contactId)?.department?.name || 'No department';
    const bk = bucketKey(t.createdAt, granularity);
    const cur = submissionsByDeptOverTime.get(bk) || { date: bk };
    cur[deptName] = (cur[deptName] || 0) + 1;
    submissionsByDeptOverTime.set(bk, cur);
  });

  return {
    summary: {
      totalContacts: contacts.length,
      contactsWithOpenTickets,
      mostActiveContact: mostActiveContact?.name || null,
      departmentWithMostTickets: deptRows.length ? deptRows[0].name : null,
    },
    chartData: {
      byDepartment: deptRows.map((d) => ({ name: d.name, count: d.totalTickets })),
      topContacts,
      submissionsByDeptOverTime: [...submissionsByDeptOverTime.values()].sort((a, b) => a.date.localeCompare(b.date)),
    },
    tableData: {
      columns: [
        { key: 'name', label: 'Department' },
        { key: 'totalContacts', label: 'Contacts' },
        { key: 'totalTickets', label: 'Tickets' },
        { key: 'openTickets', label: 'Open' },
        { key: 'closedTickets', label: 'Closed' },
        { key: 'avgResolutionHours', label: 'Avg resolution (hrs)' },
      ],
      rows: deptRows,
    },
  };
}

const contactsReport = asyncHandler(async (req, res) => res.json(await buildContactsReport(req)));
const contactsReportExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildContactsReport(req);
  sendCsv(res, 'contacts', tableData.columns, tableData.rows);
});

// ==================== Raw ticket list export (Settings -> Export) ====================
// Unlike the aggregated Ticket Volume report above, this is a flat row-per-
// ticket dump — the Export settings page's "Tickets" button, not part of
// the 7-report nav.
const TICKET_EXPORT_COLUMNS = [
  { key: 'ticketNumber', label: 'Ticket #' },
  { key: 'title', label: 'Title' },
  { key: 'type', label: 'Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'department', label: 'Department' },
  { key: 'createdAt', label: 'Created' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'resolvedAt', label: 'Resolved' },
];
const ticketsExport = asyncHandler(async (req, res) => {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const where = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId);
  const tickets = await Ticket.findAll({
    where,
    include: [
      { model: User, as: 'assignee', attributes: userAttrs },
      { model: Department, as: 'department', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
  });

  const rows = tickets.map((t) => ({
    ticketNumber: `#${String(t.id).padStart(5, '0')}`,
    title: t.title,
    type: t.type,
    priority: t.priority,
    status: t.status,
    assignee: t.assignee?.displayName || '',
    department: t.department?.name || '',
    createdAt: t.createdAt ? t.createdAt.toISOString().slice(0, 10) : '',
    dueDate: t.dueDate || '',
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString().slice(0, 10) : '',
  }));

  sendCsv(res, 'tickets', TICKET_EXPORT_COLUMNS, rows);
});

// ==================== Customer happiness (pre-existing, untouched logic) ====================
// Kept as its own report — not part of the new 5-category nav, but the
// Settings -> Customer Happiness page promises "CSAT scores are available
// on the Reports page", so the endpoint stays live even though it isn't one
// of the 7 new reports.

// GET /reports/csat — customer happiness: overall score + breakdown by technician
// and department. Score = % of "happy" ratings (neutral counts as half).
const csat = asyncHandler(async (req, res) => {
  const scope = await getUserReportScope(req.user.id);
  const requestedDepartmentId = parseDepartmentId(req.query);
  const respondedRange = parseDateRange({ startDate: req.query.from, endDate: req.query.to });
  let where = dateWhere('respondedAt', respondedRange);
  if (scope === 'department') {
    where = { ...where, '$ticket.departmentId$': req.user.departmentId };
  } else if (scope === 'own') {
    where = { ...where, '$ticket.assigneeId$': req.user.id };
  } else if (scope === 'all' && requestedDepartmentId) {
    where = { ...where, '$ticket.departmentId$': requestedDepartmentId };
  }

  const responses = await CsatResponse.findAll({
    where,
    include: [
      {
        model: Ticket,
        as: 'ticket',
        attributes: ['id', 'assigneeId', 'departmentId'],
        include: [
          { model: User, as: 'assignee', attributes: ['id', 'displayName'] },
          { model: Department, as: 'department', attributes: ['id', 'name'] },
        ],
      },
    ],
  });

  const blank = () => ({ happy: 0, neutral: 0, unhappy: 0, total: 0 });
  const score = (b) => (b.total ? Math.round((100 * (b.happy + 0.5 * b.neutral)) / b.total) : null);

  const overall = blank();
  const byTech = new Map();
  const byDept = new Map();

  const add = (map, key, label, rating) => {
    const cur = map.get(key) || { key, label, ...blank() };
    cur[rating] += 1;
    cur.total += 1;
    map.set(key, cur);
  };

  for (const r of responses) {
    overall[r.rating] += 1;
    overall.total += 1;
    const tech = r.ticket?.assignee;
    add(byTech, tech ? tech.id : 'unassigned', tech ? tech.displayName : 'Unassigned', r.rating);
    const dept = r.ticket?.department;
    add(byDept, dept ? dept.id : 'none', dept ? dept.name : 'Unassigned', r.rating);
  }

  const withScore = (map) =>
    [...map.values()].map((b) => ({ ...b, score: score(b) })).sort((a, b) => b.total - a.total);

  res.json({
    range: { from: req.query.from || null, to: req.query.to || null },
    overall: { ...overall, score: score(overall) },
    byTechnician: withScore(byTech),
    byDepartment: withScore(byDept),
  });
});

module.exports = {
  parseDateRange, dateWhere, parseDepartmentId, parseAssigneeId, granularityFor, bucketKey,
  ticketScopeWhere, projectScopeWhere, contactDeptWhere, csvCell, sendCsv, hoursBetween, userAttrs,
  ticketVolume, ticketVolumeExport, ticketTrends, ticketTrendsExport,
  teamPerformance, teamPerformanceExport, slaCompliance, slaComplianceExport,
  timeBilling, timeBillingExport, projectsReport, projectsReportExport,
  contactsReport, contactsReportExport, csat,
  ticketsExport,
};
