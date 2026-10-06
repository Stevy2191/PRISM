// Team performance report.
const { Op, fn, col } = require('sequelize');
const {
  Ticket, TimeEntry, User, Department, Comment, Project,
} = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const {
  parseDateRange,
  dateWhere,
  dateOnlyWhere,
  ledgerCompanyWhere,
  parseDepartmentId,
  sendCsv,
  hoursBetween,
  userAttrs,
} = require('./shared');

// ==================== Report 3: Team Performance ====================

async function buildTeamPerformanceReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = await parseDateRange(req.query);
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
  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);
  const fenced = (where) => andWhere(where, companyWhere);

  const [assignedTickets, closedTickets, workloadCounts, timeEntries] = await Promise.all([
    Ticket.findAll({ where: fenced({ assigneeId: { [Op.in]: techIds }, ...dateWhere('createdAt', range) }), attributes: ['id', 'assigneeId', 'createdAt'], raw: true }),
    Ticket.findAll({ where: fenced({ assigneeId: { [Op.in]: techIds }, resolvedAt: { [Op.ne]: null }, ...dateWhere('resolvedAt', range) }), attributes: ['id', 'assigneeId', 'createdAt', 'resolvedAt'], raw: true }),
    Ticket.findAll({ where: fenced({ assigneeId: { [Op.in]: techIds }, status: { [Op.in]: buckets.open } }), attributes: ['assigneeId', [fn('COUNT', col('id')), 'count']], group: ['assigneeId'], raw: true }),
    // Q10: all of a person's time in the ledger, by work date, fenced
    // through its ticket or project.
    TimeEntry.findAll({
      where: andWhere(
        { userId: { [Op.in]: techIds }, ...dateOnlyWhere('entryDate', range) },
        await ledgerCompanyWhere(req.user, req.query.companyId)
      ),
      include: [
        { model: Ticket, as: 'ticket', attributes: [], required: false },
        { model: Project, as: 'project', attributes: [], required: false },
      ],
      attributes: ['userId', [fn('SUM', col('TimeEntry.durationSeconds')), 'seconds']],
      group: ['TimeEntry.userId'],
      raw: true,
    }),
  ]);
  const overdueCounts = await Ticket.findAll({
    where: fenced({ assigneeId: { [Op.in]: techIds }, status: { [Op.in]: buckets.open }, dueDate: { [Op.ne]: null, [Op.lt]: todayStr } }),
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
  const timeByTech = new Map(timeEntries.map((r) => [r.userId, (Number(r.seconds) || 0) / 60]));

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

module.exports = {
  teamPerformance,
  teamPerformanceExport,
};
