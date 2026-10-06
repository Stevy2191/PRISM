// License and contract reports: inventory, summary, spend, renewals.
const { Op } = require('sequelize');
const { Department, License, Contract, ContractAsset } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const { parseDateRange, parseDepartmentId, resolveReportDeptId, sendCsv } = require('./shared');
const { orgTimeZone, todayInZone, addDays } = require('../../utils/orgTime');

// ==================== Licenses & Contracts ====================

const licenseInclude = [{ model: Department, as: 'department', attributes: ['id', 'name'] }];

const contractIncludeReport = [{ model: Department, as: 'department', attributes: ['id', 'name'] }];

function licenseRow(l) {
  return {
    name: l.name,
    vendor: l.vendor || '',
    licenseType: l.licenseType,
    totalSeats: l.totalSeats === null ? 'Unlimited' : l.totalSeats,
    usedSeats: l.usedSeats,
    department: l.department?.name || '',
    expiryDate: l.expiryDate || '',
    annualCost: l.annualCost === null ? '' : Number(l.annualCost),
    autoRenews: l.autoRenews ? 'Yes' : 'No',
  };
}

function contractRow(c, assetsCoveredCount) {
  return {
    name: c.name,
    vendor: c.vendor || '',
    contractType: c.contractType,
    department: c.department?.name || '',
    startDate: c.startDate || '',
    endDate: c.endDate || '',
    renewalDate: c.renewalDate || '',
    annualCost: c.annualCost === null ? '' : Number(c.annualCost),
    totalValue: c.totalValue === null ? '' : Number(c.totalValue),
    autoRenews: c.autoRenews ? 'Yes' : 'No',
    assetsCoveredCount: assetsCoveredCount ?? 0,
  };
}

// GET /reports/licenses/inventory — every license, seats, cost, expiry.
async function buildLicensesInventoryReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = {};
  if (deptId) where.departmentId = deptId;
  if (req.query.licenseType) where.licenseType = req.query.licenseType;

  const licenses = await License.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: licenseInclude, order: [['name', 'ASC']] });
  const totalAnnualCost = licenses.reduce((sum, l) => sum + (l.annualCost ? Number(l.annualCost) : 0), 0);
  const totalSeats = licenses.reduce((sum, l) => sum + (l.totalSeats || 0), 0);
  const usedSeats = licenses.reduce((sum, l) => sum + (l.usedSeats || 0), 0);

  return {
    summary: { total: licenses.length, totalAnnualCost, totalSeats, usedSeats },
    tableData: {
      columns: [
        { key: 'name', label: 'Name' }, { key: 'vendor', label: 'Vendor' },
        { key: 'licenseType', label: 'Type' }, { key: 'totalSeats', label: 'Total seats' },
        { key: 'usedSeats', label: 'Used seats' }, { key: 'department', label: 'Department' },
        { key: 'expiryDate', label: 'Expiry date' }, { key: 'annualCost', label: 'Annual cost' },
        { key: 'autoRenews', label: 'Auto-renews' },
      ],
      rows: licenses.map(licenseRow),
    },
  };
}

const licensesInventory = asyncHandler(async (req, res) => res.json(await buildLicensesInventoryReport(req)));

const licensesInventoryExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildLicensesInventoryReport(req);
  sendCsv(res, 'licenses-inventory', tableData.columns, tableData.rows);
});

// GET /reports/contracts/summary — every contract, cost, renewal date.
async function buildContractsSummaryReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = {};
  if (deptId) where.departmentId = deptId;
  if (req.query.contractType) where.contractType = req.query.contractType;

  const contracts = await Contract.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: contractIncludeReport, order: [['name', 'ASC']] });
  const assetCounts = await ContractAsset.findAll({ where: { contractId: { [Op.in]: contracts.map((c) => c.id) } }, attributes: ['contractId'] });
  const countByContract = new Map();
  assetCounts.forEach((r) => countByContract.set(r.contractId, (countByContract.get(r.contractId) || 0) + 1));

  const totalAnnualCost = contracts.reduce((sum, c) => sum + (c.annualCost ? Number(c.annualCost) : 0), 0);
  const totalValue = contracts.reduce((sum, c) => sum + (c.totalValue ? Number(c.totalValue) : 0), 0);

  return {
    summary: { total: contracts.length, totalAnnualCost, totalValue },
    tableData: {
      columns: [
        { key: 'name', label: 'Name' }, { key: 'vendor', label: 'Vendor' },
        { key: 'contractType', label: 'Type' }, { key: 'department', label: 'Department' },
        { key: 'startDate', label: 'Start date' }, { key: 'endDate', label: 'End date' },
        { key: 'renewalDate', label: 'Renewal date' }, { key: 'annualCost', label: 'Annual cost' },
        { key: 'totalValue', label: 'Total value' }, { key: 'autoRenews', label: 'Auto-renews' },
        { key: 'assetsCoveredCount', label: 'Assets covered' },
      ],
      rows: contracts.map((c) => contractRow(c, countByContract.get(c.id))),
    },
  };
}

const contractsSummary = asyncHandler(async (req, res) => res.json(await buildContractsSummaryReport(req)));

const contractsSummaryExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildContractsSummaryReport(req);
  sendCsv(res, 'contracts-summary', tableData.columns, tableData.rows);
});

// GET /reports/licenses/spend — sum of license annual costs by department.
async function buildSoftwareSpendReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = {};
  if (deptId) where.departmentId = deptId;

  const licenses = await License.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: licenseInclude });
  const byDept = new Map();
  licenses.forEach((l) => {
    const name = l.department?.name || 'Unassigned';
    const cur = byDept.get(name) || { department: name, licenseCount: 0, totalAnnualCost: 0 };
    cur.licenseCount += 1;
    cur.totalAnnualCost += l.annualCost ? Number(l.annualCost) : 0;
    byDept.set(name, cur);
  });
  const rows = [...byDept.values()].sort((a, b) => b.totalAnnualCost - a.totalAnnualCost);
  const totalAnnualCost = rows.reduce((sum, r) => sum + r.totalAnnualCost, 0);

  return {
    summary: { totalAnnualCost, licenseCount: licenses.length },
    chartData: { byDepartment: rows.map((r) => ({ name: r.department, value: r.totalAnnualCost })) },
    tableData: {
      columns: [
        { key: 'department', label: 'Department' }, { key: 'licenseCount', label: 'Licenses' },
        { key: 'totalAnnualCost', label: 'Total annual cost' },
      ],
      rows,
    },
  };
}

const softwareSpend = asyncHandler(async (req, res) => res.json(await buildSoftwareSpendReport(req)));

const softwareSpendExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildSoftwareSpendReport(req);
  sendCsv(res, 'software-spend', tableData.columns, tableData.rows);
});

// GET /reports/contracts/spend — sum of contract annual costs by department.
async function buildContractSpendReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = {};
  if (deptId) where.departmentId = deptId;

  const contracts = await Contract.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: contractIncludeReport });
  const byDept = new Map();
  contracts.forEach((c) => {
    const name = c.department?.name || 'Unassigned';
    const cur = byDept.get(name) || { department: name, contractCount: 0, totalAnnualCost: 0 };
    cur.contractCount += 1;
    cur.totalAnnualCost += c.annualCost ? Number(c.annualCost) : 0;
    byDept.set(name, cur);
  });
  const rows = [...byDept.values()].sort((a, b) => b.totalAnnualCost - a.totalAnnualCost);
  const totalAnnualCost = rows.reduce((sum, r) => sum + r.totalAnnualCost, 0);

  return {
    summary: { totalAnnualCost, contractCount: contracts.length },
    chartData: { byDepartment: rows.map((r) => ({ name: r.department, value: r.totalAnnualCost })) },
    tableData: {
      columns: [
        { key: 'department', label: 'Department' }, { key: 'contractCount', label: 'Contracts' },
        { key: 'totalAnnualCost', label: 'Total annual cost' },
      ],
      rows,
    },
  };
}

const contractSpend = asyncHandler(async (req, res) => res.json(await buildContractSpendReport(req)));

const contractSpendExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildContractSpendReport(req);
  sendCsv(res, 'contract-spend', tableData.columns, tableData.rows);
});

// GET /reports/licenses-contracts/upcoming-renewals — licenses (by
// expiryDate) and contracts (by renewalDate, falling back to endDate)
// renewing within a date range, combined into one sorted list. No range
// given defaults to "within the next 90 days".
async function buildUpcomingRenewalsReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const range = await parseDateRange(req.query);
  // Expiry and renewal dates are DATEONLY: compare as the organization's dates.
  const today = todayInZone(await orgTimeZone());
  const startStr = range.startDate || today;
  const endStr = range.endDate || addDays(today, 90);

  const licenseWhere = { expiryDate: { [Op.ne]: null, [Op.gte]: startStr, [Op.lte]: endStr } };
  if (deptId) licenseWhere.departmentId = deptId;
  const contractWhere = {
    [Op.or]: [
      { renewalDate: { [Op.ne]: null, [Op.gte]: startStr, [Op.lte]: endStr } },
      { renewalDate: null, endDate: { [Op.ne]: null, [Op.gte]: startStr, [Op.lte]: endStr } },
    ],
  };
  if (deptId) contractWhere.departmentId = deptId;
  const companyWhere = await companyFilterWhere(req.user, req.query.companyId);

  const [licenses, contracts] = await Promise.all([
    License.findAll({ where: andWhere(licenseWhere, companyWhere), include: licenseInclude }),
    Contract.findAll({ where: andWhere(contractWhere, companyWhere), include: contractIncludeReport }),
  ]);

  const rows = [
    ...licenses.map((l) => ({
      type: 'License', name: l.name, vendor: l.vendor || '', renewalDate: l.expiryDate,
      department: l.department?.name || '', annualCost: l.annualCost === null ? '' : Number(l.annualCost),
    })),
    ...contracts.map((c) => ({
      type: 'Contract', name: c.name, vendor: c.vendor || '', renewalDate: c.renewalDate || c.endDate,
      department: c.department?.name || '', annualCost: c.annualCost === null ? '' : Number(c.annualCost),
    })),
  ].sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));

  return {
    summary: { total: rows.length, licenseCount: licenses.length, contractCount: contracts.length },
    tableData: {
      columns: [
        { key: 'type', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'vendor', label: 'Vendor' },
        { key: 'renewalDate', label: 'Renewal/expiry date' }, { key: 'department', label: 'Department' },
        { key: 'annualCost', label: 'Annual cost' },
      ],
      rows,
    },
  };
}

const upcomingRenewals = asyncHandler(async (req, res) => res.json(await buildUpcomingRenewalsReport(req)));

const upcomingRenewalsExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildUpcomingRenewalsReport(req);
  sendCsv(res, 'upcoming-renewals', tableData.columns, tableData.rows);
});

module.exports = {
  licensesInventory,
  licensesInventoryExport,
  contractsSummary,
  contractsSummaryExport,
  softwareSpend,
  softwareSpendExport,
  contractSpend,
  contractSpendExport,
  upcomingRenewals,
  upcomingRenewalsExport,
};
