// CSAT and customer happiness reports.
const { Ticket, User, Department, CsatResponse } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { getOverview, getTeamHappiness } = require('../../services/csatStatsService');
const { parseDateRange, dateWhere, parseDepartmentId, sendCsv } = require('./shared');

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

  // Fenced through the ticket (included below).
  where = andWhere(where, await companyFilterWhere(req.user, req.query.companyId, '$ticket.companyId$'));

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

// ==================== Customer Happiness (new, token-based CsatSurvey) ====================
// Distinct from `csat` above (the pre-existing staff-entered happy/neutral/
// unhappy report) — this is the real customer-happiness report, sourced
// from contacts' own 1-5 star survey responses.

async function buildCustomerHappinessReport(req) {
  const range = parseDateRange(req.query);
  // Scoped like every other report (S12): 'all' may pick a department,
  // 'department' is pinned to the reader's own, 'own' sees only surveys on
  // tickets assigned to the reader.
  const scope = await getUserReportScope(req.user.id);
  let deptId = null;
  let userId = null;
  if (scope === 'all') deptId = parseDepartmentId(req.query);
  else if (scope === 'department') deptId = req.user.departmentId || -1; // no department -> match nothing
  else userId = req.user.id;

  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);
  const [overview, byTech] = await Promise.all([
    getOverview({ range, departmentId: deptId, userId, companyWhere }),
    getTeamHappiness({ range, departmentId: deptId, userId, companyWhere }),
  ]);

  return {
    summary: {
      overallScore: overview.overallScore,
      responseCount: overview.responseCount,
      sentCount: overview.sentCount,
      responseRate: overview.responseRate,
    },
    chartData: {
      scoreTrend: overview.scoreTrend,
      scoreByTech: byTech.filter((t) => t.responseCount > 0).map((t) => ({ name: t.name, score: t.avgRating })),
      scoreByDepartment: overview.scoreByDepartment,
    },
    recentComments: overview.recentComments,
    tableData: {
      columns: customerHappinessColumns(),
      rows: overview.tableRows,
    },
  };
}

function customerHappinessColumns() {
  return [
    { key: 'ticketNumber', label: 'Ticket #' },
    { key: 'ticketTitle', label: 'Title' },
    { key: 'contact', label: 'Contact' },
    { key: 'tech', label: 'Tech' },
    { key: 'rating', label: 'Rating' },
    { key: 'comment', label: 'Comment' },
    { key: 'date', label: 'Date' },
  ];
}

const customerHappiness = asyncHandler(async (req, res) => res.json(await buildCustomerHappinessReport(req)));

const customerHappinessExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildCustomerHappinessReport(req);
  sendCsv(res, 'customer-happiness', tableData.columns, tableData.rows);
});

module.exports = {
  csat,
  customerHappiness,
  customerHappinessExport,
};
