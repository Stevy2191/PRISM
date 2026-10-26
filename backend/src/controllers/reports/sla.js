// SLA compliance report, read from the stored SLA clocks (TicketSlas).
// Range filters on the ticket's creation date. A clock counts once it has a
// result: breached, or met (assigned / first response given / resolved)
// within its target. Clocks still running count only toward the open
// "breached" and "at risk" figures.
const {
  Ticket, TicketSla, User, Department, Company, TicketDueDateChange,
} = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { companyFilterWhere } = require('../../services/recordScope');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const { toSlaView } = require('../../services/sla/slaView');
const { liveUsedMinutes } = require('../../services/sla/ticketSla');
const {
  parseDateRange, dateWhere, parseDepartmentId, granularityFor, bucketKey, ticketScopeWhere, sendCsv, userAttrs,
} = require('./shared');

const CLOCKS = ['assign', 'response', 'resolution'];
const LABEL = { assign: 'Assignment', response: 'First response', resolution: 'Resolution' };

// 'met' | 'breached' | null (no result yet, or not tracked).
function outcome(row, c) {
  if (row[`${c}TargetMinutes`] === null || row[`${c}TargetMinutes`] === undefined) return null;
  if (row[`${c}BreachedAt`]) return 'breached';
  if (row[`${c}MetAt`] && !row[`${c}RunningSince`]) return 'met';
  return null;
}

const pct = (met, breached) => (met + breached ? Math.round((100 * met) / (met + breached)) : null);

async function buildSlaComplianceReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = await parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);
  const now = new Date();

  const tickets = await Ticket.findAll({
    where: ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId, companyWhere),
    attributes: ['id', 'title', 'status', 'createdAt', 'assigneeId', 'departmentId', 'companyId'],
    include: [
      { model: TicketSla, as: 'sla', required: true },
      { model: User, as: 'assignee', attributes: userAttrs },
      { model: Department, as: 'department', attributes: ['id', 'name'] },
      { model: Company, as: 'company', attributes: ['id', 'name'] },
    ],
    order: [['id', 'ASC']],
  });

  const clocks = {};
  CLOCKS.forEach((c) => { clocks[c] = { tracked: 0, met: 0, breached: 0 }; });
  const byTech = new Map();
  const byDept = new Map();
  const byCompany = new Map();
  const trend = new Map();
  const granularity = granularityFor(range) === 'day' ? 'week' : granularityFor(range);
  const bump = (map, key, name, result) => {
    const cur = map.get(key) || { name, met: 0, breached: 0 };
    cur[result] += 1;
    map.set(key, cur);
  };
  const breaches = [];

  const buckets = await getTicketStatusBuckets();
  let openBreached = 0;
  let openAtRisk = 0;
  // Resolved tickets against the SLA as first set and as finally due.
  const resolution = { closed: 0, metOriginal: 0, metDue: 0 };

  // eslint-disable-next-line no-restricted-syntax
  for (const t of tickets) {
    CLOCKS.forEach((c) => {
      const result = outcome(t.sla, c);
      if (!result) return;
      clocks[c].tracked += 1;
      clocks[c][result] += 1;
    });
    const res = outcome(t.sla, 'resolution');
    if (res) {
      bump(byTech, t.assigneeId || 'unassigned', t.assignee?.displayName || 'Unassigned', res);
      bump(byDept, t.departmentId || 'none', t.department?.name || 'No department', res);
      bump(byCompany, t.companyId, t.company?.name || '—', res);
      const key = bucketKey(t.createdAt, granularity, range.tz);
      const cur = trend.get(key) || { date: key, met: 0, breached: 0 };
      cur[res] += 1;
      trend.set(key, cur);
    }
    const doneAt = t.sla.resolutionMetAt && !t.sla.resolutionRunningSince ? new Date(t.sla.resolutionMetAt) : null;
    if (doneAt && t.sla.resolutionDueAt) {
      resolution.closed += 1;
      if (doneAt <= new Date(t.sla.resolutionOriginalDueAt || t.sla.resolutionDueAt)) resolution.metOriginal += 1;
      if (doneAt <= new Date(t.sla.resolutionDueAt)) resolution.metDue += 1;
    }
    if (buckets.open.includes(t.status)) {
      const view = toSlaView(t.sla, now);
      if (CLOCKS.some((c) => view.clocks[c].state === 'breached')) openBreached += 1;
      else if (CLOCKS.some((c) => view.clocks[c].atRisk)) openAtRisk += 1;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const c of CLOCKS) {
      if (t.sla[`${c}BreachedAt`]) {
        // eslint-disable-next-line no-await-in-loop
        const used = await liveUsedMinutes(t.sla, c, now);
        breaches.push({
          id: t.id,
          ticketNumber: String(t.id).padStart(5, '0'),
          title: t.title,
          assignee: t.assignee?.displayName || 'Unassigned',
          company: t.company?.name || '',
          clock: LABEL[c],
          // A breach is dated at the due time it passed.
          dueAt: new Date(t.sla[`${c}BreachedAt`]).toISOString(),
          overByMinutes: Math.max(0, used - t.sla[`${c}TargetMinutes`]),
        });
      }
    }
  }

  CLOCKS.forEach((c) => { clocks[c].pctMet = pct(clocks[c].met, clocks[c].breached); });

  // Due date changes on the tickets in this report (already scoped).
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const changes = byId.size ? await TicketDueDateChange.findAll({
    where: { ticketId: [...byId.keys()] },
    include: [{ model: User, as: 'user', attributes: ['id', 'displayName'] }],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  }) : [];
  const extensions = changes.map((ch) => ({
    id: ch.ticketId,
    ticketNumber: String(ch.ticketId).padStart(5, '0'),
    title: byId.get(ch.ticketId).title,
    kind: ch.kind,
    from: ch.fromDueAt ? new Date(ch.fromDueAt).toISOString() : null,
    to: new Date(ch.toDueAt).toISOString(),
    reason: ch.reason,
    by: ch.user ? ch.user.displayName : 'Workflow rule',
    at: new Date(ch.createdAt).toISOString(),
  }));
  const extendedTickets = new Set(changes.filter((ch) => ch.kind === 'extension').map((ch) => ch.ticketId));

  return {
    summary: {
      clocks,
      openBreached,
      openAtRisk,
      resolution: {
        closed: resolution.closed,
        metOriginal: resolution.metOriginal,
        pctMetOriginal: pct(resolution.metOriginal, resolution.closed - resolution.metOriginal),
        metDue: resolution.metDue,
        pctMetDue: pct(resolution.metDue, resolution.closed - resolution.metDue),
        extended: extendedTickets.size,
      },
    },
    extensions,
    chartData: {
      metVsBreachedByTech: [...byTech.values()],
      metVsBreachedByDept: [...byDept.values()],
      metVsBreachedByCompany: [...byCompany.values()],
      complianceTrend: [...trend.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ date: r.date, pctMet: pct(r.met, r.breached) })),
    },
    tableData: {
      columns: [
        { key: 'ticketNumber', label: 'Ticket #' },
        { key: 'title', label: 'Title' },
        { key: 'assignee', label: 'Assignee' },
        { key: 'company', label: 'Company' },
        { key: 'clock', label: 'Clock' },
        { key: 'dueAt', label: 'Due' },
        { key: 'overByMinutes', label: 'Minutes over' },
      ],
      rows: breaches,
    },
  };
}

const slaCompliance = asyncHandler(async (req, res) => res.json(await buildSlaComplianceReport(req)));

const slaComplianceExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildSlaComplianceReport(req);
  sendCsv(res, 'sla-compliance', tableData.columns, tableData.rows);
});

module.exports = {
  slaCompliance,
  slaComplianceExport,
};
