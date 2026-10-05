// SLA compliance report.
const { Op } = require('sequelize');
const { Ticket, User, Department } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const {
  parseDateRange,
  dateWhere,
  parseDepartmentId,
  granularityFor,
  bucketKey,
  ticketScopeWhere,
  sendCsv,
  hoursBetween,
  userAttrs,
} = require('./shared');

// ==================== Report 4: SLA Compliance ====================

async function buildSlaComplianceReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);
  const closedWithDueDate = await Ticket.findAll({
    where: ticketScopeWhere({ resolvedAt: { [Op.ne]: null }, dueDate: { [Op.ne]: null }, ...dateWhere('resolvedAt', range) }, scope, req.user, deptId, companyWhere),
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
  const openWhere = ticketScopeWhere({ status: { [Op.in]: buckets.open } }, scope, req.user, deptId, companyWhere);
  const [openTotal, openOverdue] = await Promise.all([
    Ticket.count({ where: openWhere }),
    Ticket.count({ where: andWhere(openWhere, { dueDate: { [Op.ne]: null, [Op.lt]: todayStr } }) }),
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

module.exports = {
  slaCompliance,
  slaComplianceExport,
};
