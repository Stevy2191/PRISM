// Projects report.
const {
  ProjectTimeEntry,
  Project,
  ProjectExpense,
  ProjectMaterial,
  Department,
} = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { companyFilterWhere } = require('../../services/recordScope');
const { getProjectStatusBuckets } = require('../../services/statusBehavior');
const { computeProjectCompletion } = require('../../services/projectCompletion');
const { parseDateRange, parseDepartmentId, projectScopeWhere, sendCsv } = require('./shared');

// ==================== Report 6: Projects ====================

async function buildProjectsReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const where = projectScopeWhere({}, scope, req.user, deptId, await companyFilterWhere(req.user, req.query.companyId));
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

  const rows = await Promise.all(projects.map(async (p) => {
    const [completion, timeSum, expenseSum, materialSum] = await Promise.all([
      computeProjectCompletion(p.id),
      ProjectTimeEntry.sum('durationSeconds', { where: { projectId: p.id } }),
      ProjectExpense.sum('amount', { where: { projectId: p.id } }),
      ProjectMaterial.sum('totalCost', { where: { projectId: p.id } }),
    ]);
    const materials = Number(materialSum) || 0;
    const expenses = Number(expenseSum) || 0;
    return {
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
    };
  }));
  let totalMaterialsCost = 0;
  let totalExpensesCost = 0;
  rows.forEach((r) => {
    totalMaterialsCost += r.materialsCost;
    totalExpensesCost += r.expensesCost;
  });

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

module.exports = {
  projectsReport,
  projectsReportExport,
};
