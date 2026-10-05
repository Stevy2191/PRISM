// Ticket volume and trend reports, and the raw ticket export.
const { Op, fn, col } = require('sequelize');
const { Ticket, User, Department, Contact } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const {
  parseDateRange,
  dateWhere,
  parseDepartmentId,
  parseAssigneeId,
  granularityFor,
  bucketKey,
  ticketScopeWhere,
  sendCsv,
  hoursBetween,
  userAttrs,
} = require('./shared');

// ==================== Report 1: Ticket Volume ====================

async function buildTicketVolumeReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const assigneeId = parseAssigneeId(req.query);

  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);
  let where = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId, companyWhere);
  if (assigneeId) where = andWhere(where, { assigneeId });

  const tickets = await Ticket.findAll({
    where,
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });

  // "Currently open" is a live snapshot, not bound to the date range —
  // otherwise a ticket created last quarter and still open wouldn't count.
  let openNowWhere = ticketScopeWhere({}, scope, req.user, deptId, companyWhere);
  if (assigneeId) openNowWhere = andWhere(openNowWhere, { assigneeId });
  const buckets = await getTicketStatusBuckets();
  const currentlyOpen = await Ticket.count({ where: andWhere(openNowWhere, { status: { [Op.in]: buckets.open } }) });

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
      bySource: countBy('source'),
    },
    tableData: {
      columns: [
        { key: 'ticketNumber', label: 'Ticket #' },
        { key: 'title', label: 'Title' },
        { key: 'type', label: 'Type' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'source', label: 'Source' },
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
        source: t.source,
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

  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);
  const createdWhere = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId, companyWhere);
  const closedWhere = ticketScopeWhere(dateWhere('resolvedAt', range), scope, req.user, deptId, companyWhere);

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
  { key: 'source', label: 'Source' },
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

  const where = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId, await companyFilterWhere(req.user, req.query.companyId));
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
    source: t.source,
    assignee: t.assignee?.displayName || '',
    department: t.department?.name || '',
    createdAt: t.createdAt ? t.createdAt.toISOString().slice(0, 10) : '',
    dueDate: t.dueDate || '',
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString().slice(0, 10) : '',
  }));

  sendCsv(res, 'tickets', TICKET_EXPORT_COLUMNS, rows);
});

module.exports = {
  ticketVolume,
  ticketVolumeExport,
  ticketTrends,
  ticketTrendsExport,
  ticketsExport,
};
