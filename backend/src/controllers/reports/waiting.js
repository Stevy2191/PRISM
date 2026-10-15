// Waiting on the customer (user decisions 2026-10-15): how much of each
// ticket's life was spent in statuses switched on as "counts as waiting".
// A separate figure — lifecycle times and the SLA still include it all.
// Range filters on the ticket's creation date; open tickets are measured to
// now. Per tech means the current assignee.
const { Op } = require('sequelize');
const { Ticket, User, Company } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { waitingForTickets, pctOf } = require('../../services/ticketWaiting');
const {
  parseDateRange, dateWhere, parseDepartmentId, parseAssigneeId, granularityFor, bucketKey, ticketScopeWhere, sendCsv, userAttrs,
} = require('./shared');

const hours = (ms) => Math.round(ms / 360000) / 10;

function group() {
  const map = new Map();
  return {
    add(key, name, w) {
      const cur = map.get(key) || {
        name, tickets: 0, waitingMs: 0, lifeMs: 0,
      };
      cur.tickets += 1;
      cur.waitingMs += w.waitingMs;
      cur.lifeMs += w.lifeMs;
      map.set(key, cur);
    },
    rows: () => [...map.values()].map(figures),
  };
}

function figures(g) {
  return {
    name: g.name,
    tickets: g.tickets,
    waitingHours: hours(g.waitingMs),
    avgWaitingHours: g.tickets ? hours(g.waitingMs / g.tickets) : null,
    pctWaiting: pctOf(g.waitingMs, g.lifeMs),
  };
}

async function buildCustomerWaitingReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = await parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const assigneeId = parseAssigneeId(req.query);
  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);

  let where = ticketScopeWhere(dateWhere('createdAt', range), scope, req.user, deptId, companyWhere);
  if (assigneeId) where = andWhere(where, { assigneeId });
  if (req.query.closedOnly === 'true') where = andWhere(where, { resolvedAt: { [Op.ne]: null } });

  const tickets = await Ticket.findAll({
    where,
    attributes: ['id', 'title', 'status', 'createdAt', 'resolvedAt', 'assigneeId', 'companyId'],
    include: [
      { model: User, as: 'assignee', attributes: userAttrs },
      { model: Company, as: 'company', attributes: ['id', 'name'] },
    ],
    order: [['id', 'ASC']],
  });
  const waiting = await waitingForTickets(tickets);

  const granularity = granularityFor(range);
  const total = { name: 'All', tickets: 0, waitingMs: 0, lifeMs: 0 };
  const byTech = group();
  const byCompany = group();
  const byPeriod = group();
  let waitingNow = 0;
  const rows = tickets.map((t) => {
    const w = waiting.get(t.id);
    total.tickets += 1;
    total.waitingMs += w.waitingMs;
    total.lifeMs += w.lifeMs;
    if (w.waitingNow) waitingNow += 1;
    byTech.add(t.assigneeId || 'unassigned', t.assignee?.displayName || 'Unassigned', w);
    byCompany.add(t.companyId || 'none', t.company?.name || '—', w);
    const period = bucketKey(t.createdAt, granularity);
    byPeriod.add(period, period, w);
    return {
      id: t.id,
      ticketNumber: String(t.id).padStart(5, '0'),
      title: t.title,
      status: t.status,
      assignee: t.assignee?.displayName || 'Unassigned',
      company: t.company?.name || '',
      createdAt: t.createdAt.toISOString().slice(0, 10),
      resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString().slice(0, 10) : '',
      lifeHours: hours(w.lifeMs),
      waitingHours: hours(w.waitingMs),
      waitingPct: pctOf(w.waitingMs, w.lifeMs) ?? '',
      waitingNow: w.waitingNow,
    };
  });

  const { name, ...summary } = figures(total);
  return {
    summary: { ...summary, lifeHours: hours(total.lifeMs), waitingNow },
    granularity,
    byTech: byTech.rows(),
    byCompany: byCompany.rows(),
    byPeriod: byPeriod.rows()
      .map(({ name: date, ...rest }) => ({ date, ...rest }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    tableData: {
      columns: [
        { key: 'ticketNumber', label: 'Ticket #' },
        { key: 'title', label: 'Title' },
        { key: 'status', label: 'Status' },
        { key: 'assignee', label: 'Assignee' },
        { key: 'company', label: 'Company' },
        { key: 'createdAt', label: 'Created' },
        { key: 'resolvedAt', label: 'Closed' },
        { key: 'lifeHours', label: 'Life (hrs)' },
        { key: 'waitingHours', label: 'Waiting (hrs)' },
        { key: 'waitingPct', label: '% waiting' },
        { key: 'waitingNow', label: 'Waiting now' },
      ],
      rows,
    },
  };
}

const customerWaiting = asyncHandler(async (req, res) => res.json(await buildCustomerWaitingReport(req)));

const customerWaitingExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildCustomerWaitingReport(req);
  const rows = tableData.rows.map((r) => ({ ...r, waitingNow: r.waitingNow ? 'Yes' : 'No' }));
  sendCsv(res, 'customer-waiting', tableData.columns, rows);
});

module.exports = {
  customerWaiting,
  customerWaitingExport,
};
