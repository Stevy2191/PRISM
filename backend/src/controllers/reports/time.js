// Time and billing report.
const { Op } = require('sequelize');
const { Ticket, TimeEntry, User, Project, Department } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere } = require('../../services/recordScope');
const {
  parseDateRange,
  dateOnlyWhere,
  ledgerCompanyWhere,
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
  const range = await parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);
  const assigneeId = parseAssigneeId(req.query);

  // Q9: time is dated and filtered by its work date.
  let where = dateOnlyWhere('entryDate', range);
  const deptOf = (id) => ({ [Op.or]: [{ '$ticket.departmentId$': id }, { '$project.ownerDepartmentId$': id }] });
  if (scope === 'department') where = andWhere(where, deptOf(req.user.departmentId));
  else if (scope === 'own') where = andWhere(where, { userId: req.user.id });
  else if (scope === 'all' && deptId) where = andWhere(where, deptOf(deptId));
  // ANDed, never merged: under 'own' scope the scope itself is on userId (S14).
  if (assigneeId) where = andWhere(where, { userId: assigneeId });
  where = andWhere(where, await ledgerCompanyWhere(req.user, req.query.companyId));

  const entries = await TimeEntry.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: userAttrs },
      {
        model: Ticket, as: 'ticket', attributes: ['id', 'title', 'type', 'departmentId'], required: false,
        include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      },
      {
        model: Project, as: 'project', attributes: ['id', 'name'], required: false,
        include: [{ model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] }],
      },
    ],
    order: [['entryDate', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
  });

  const normalized = entries.map((e) => {
    const isProject = e.projectId != null;
    return {
      date: e.entryDate,
      user: e.user,
      minutes: e.durationSeconds / 60,
      isProject,
      ticketType: isProject ? null : e.ticket?.type || null,
      reference: isProject
        ? (e.project ? `Project: ${e.project.name}` : 'Project')
        : (e.ticket ? `#${String(e.ticket.id).padStart(5, '0')} ${e.ticket.title}` : ''),
      department: isProject ? e.project?.ownerDepartment || null : e.ticket?.department || null,
      note: e.note,
      laborCost: e.laborCost,
    };
  });

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
        date: e.date || '',
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
