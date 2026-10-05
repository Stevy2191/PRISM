// Time and billing report.
const { Ticket, TimeEntry, ProjectTimeEntry, User, Project, Department } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const {
  parseDateRange,
  dateWhere,
  parseDepartmentId,
  parseAssigneeId,
  granularityFor,
  bucketKey,
  sendCsv,
  userAttrs,
} = require('./shared');

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
  // Time is fenced through its ticket or project (both are included below).
  ticketWhere = andWhere(ticketWhere, await companyFilterWhere(req.user, req.query.companyId, '$ticket.companyId$'));
  projectWhere = andWhere(projectWhere, await companyFilterWhere(req.user, req.query.companyId, '$project.companyId$'));

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

module.exports = {
  timeBilling,
  timeBillingExport,
};
