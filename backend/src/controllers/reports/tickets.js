// Ticket volume and trend reports, and the raw ticket export.
const { Op, fn, col } = require('sequelize');
const {
  Ticket, User, Department, Contact, Company, TicketSla,
} = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const { waitingForTickets, pctOf } = require('../../services/ticketWaiting');
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
const { dayOf } = require('../../utils/orgTime');
const { ticketNumberOf } = require('../../services/tickets/numbers');

// ==================== Report 1: Ticket Volume ====================

// CN: every company side by side, and the total across them (the whole
// system, within what the viewer may see). Opened and closed in the range;
// open now; SLA met = resolutions met on time out of those met or breached.
async function ticketsByCompany(tickets, openNowWhere, buckets) {
  const openRows = await Ticket.findAll({
    where: andWhere(openNowWhere, { status: { [Op.in]: buckets.open } }),
    attributes: ['companyId', [fn('COUNT', col('id')), 'n']],
    group: ['companyId'],
    raw: true,
  });
  const ids = tickets.map((t) => t.id);
  const slas = ids.length ? await TicketSla.findAll({
    where: { ticketId: ids }, attributes: ['ticketId', 'resolutionMetAt', 'resolutionBreachedAt'], raw: true,
  }) : [];
  const slaByTicket = new Map(slas.map((s) => [s.ticketId, s]));
  const rows = new Map();
  const row = (companyId) => {
    if (!rows.has(companyId)) rows.set(companyId, { companyId, opened: 0, closed: 0, openNow: 0, met: 0, judged: 0, hours: 0 });
    return rows.get(companyId);
  };
  tickets.forEach((t) => {
    const r = row(t.companyId);
    r.opened += 1;
    if (t.resolvedAt) { r.closed += 1; r.hours += hoursBetween(t.createdAt, t.resolvedAt); }
    const s = slaByTicket.get(t.id);
    if (s && (s.resolutionMetAt || s.resolutionBreachedAt)) {
      r.judged += 1;
      if (s.resolutionMetAt && !s.resolutionBreachedAt) r.met += 1;
    }
  });
  openRows.forEach((o) => { row(o.companyId).openNow = Number(o.n); });
  const companies = rows.size ? await Company.findAll({ where: { id: [...rows.keys()] }, attributes: ['id', 'name', 'code', 'isInternal'] }) : [];
  const byId = new Map(companies.map((c) => [c.id, c]));
  const shape = (r, name, extra = {}) => ({
    name,
    opened: r.opened,
    closed: r.closed,
    openNow: r.openNow,
    slaMetPct: r.judged ? Math.round((r.met / r.judged) * 100) : null,
    avgResolutionHours: r.closed ? Math.round((r.hours / r.closed) * 10) / 10 : null,
    ...extra,
  });
  const list = [...rows.values()].map((r) => {
    const c = byId.get(r.companyId);
    return shape(r, c ? c.name : 'Unknown', {
      companyId: r.companyId, code: c ? c.code : null, isInternal: !!(c && c.isInternal),
    });
  }).sort((a, b) => b.opened - a.opened || a.name.localeCompare(b.name));
  const total = [...rows.values()].reduce((t, r) => ({
    opened: t.opened + r.opened, closed: t.closed + r.closed, openNow: t.openNow + r.openNow, met: t.met + r.met, judged: t.judged + r.judged, hours: t.hours + r.hours,
  }), {
    opened: 0, closed: 0, openNow: 0, met: 0, judged: 0, hours: 0,
  });
  return { rows: list, total: shape(total, 'All companies') };
}

async function buildTicketVolumeReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = await parseDateRange(req.query);
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

  const waiting = await waitingForTickets(tickets);
  const closed = tickets.filter((t) => t.resolvedAt);
  const totalResolutionHours = closed.reduce((sum, t) => sum + hoursBetween(t.createdAt, t.resolvedAt), 0);
  const avgResolutionHours = closed.length ? totalResolutionHours / closed.length : null;

  const granularity = granularityFor(range);
  const createdByBucket = new Map();
  tickets.forEach((t) => {
    const key = bucketKey(t.createdAt, granularity, range.tz);
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
    byCompany: await ticketsByCompany(tickets, openNowWhere, buckets),
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
        { key: 'waitingHours', label: 'Waiting (hrs)' },
        { key: 'waitingPct', label: '% waiting' },
        { key: 'assignee', label: 'Assignee' },
      ],
      rows: tickets.map((t) => ({
        id: t.id,
        ticketNumber: ticketNumberOf(t),
        title: t.title,
        type: t.type,
        priority: t.priority,
        status: t.status,
        source: t.source,
        createdAt: dayOf(t.createdAt, range.tz),
        resolvedAt: t.resolvedAt ? dayOf(t.resolvedAt, range.tz) : '',
        resolutionHours: t.resolvedAt ? Math.round(hoursBetween(t.createdAt, t.resolvedAt) * 10) / 10 : '',
        waitingHours: Math.round(waiting.get(t.id).waitingMs / 360000) / 10,
        waitingPct: pctOf(waiting.get(t.id).waitingMs, waiting.get(t.id).lifeMs) ?? '',
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
  const range = await parseDateRange(req.query);
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
    const k = bucketKey(t.createdAt, granularity, range.tz);
    createdByBucket.set(k, (createdByBucket.get(k) || 0) + 1);
  });
  const closedByBucket = new Map();
  closedTickets.forEach((t) => {
    const k = bucketKey(t.resolvedAt, granularity, range.tz);
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
  const range = await parseDateRange(req.query);
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
    ticketNumber: `${ticketNumberOf(t)}`,
    title: t.title,
    type: t.type,
    priority: t.priority,
    status: t.status,
    source: t.source,
    assignee: t.assignee?.displayName || '',
    department: t.department?.name || '',
    createdAt: t.createdAt ? dayOf(t.createdAt, range.tz) : '',
    dueDate: t.dueDate || '',
    resolvedAt: t.resolvedAt ? dayOf(t.resolvedAt, range.tz) : '',
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
