// Asset reports: replacement, warranty, inventory, ticket history.
const { Op } = require('sequelize');
const { Department, Asset, AssetCategory, AssetTicket } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { andWhere, companyFilterWhere } = require('../../services/recordScope');
const {
  parseDateRange,
  dateWhere,
  parseDepartmentId,
  resolveReportDeptId,
  sendCsv,
} = require('./shared');

// ==================== Assets ====================

const assetInclude = [
  { model: AssetCategory, as: 'category' },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
];

function assetRow(a) {
  return {
    assetTag: a.assetTag,
    name: a.name,
    category: a.category?.name || '',
    department: a.department?.name || '',
    status: a.status,
    warrantyExpiryDate: a.warrantyExpiryDate || '',
    replacementPlanDate: a.replacementPlanDate || '',
  };
}

// GET /reports/assets/replacement — assets due for replacement, filterable
// by department + a date range on replacementPlanDate. No range given
// defaults to "within the next 90 days" (including anything already past
// due — that's more urgent, not less).
async function buildAssetsReplacementReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = { replacementPlanDate: { [Op.ne]: null } };
  if (deptId) where.departmentId = deptId;

  if (req.query.startDate || req.query.endDate) {
    Object.assign(where, dateWhere('replacementPlanDate', parseDateRange(req.query)));
  } else {
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    where.replacementPlanDate[Op.lte] = in90;
  }

  const assets = await Asset.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: assetInclude, order: [['replacementPlanDate', 'ASC']] });
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdue = assets.filter((a) => a.replacementPlanDate < todayStr).length;

  return {
    summary: { total: assets.length, overdue, upcoming: assets.length - overdue },
    tableData: {
      columns: [
        { key: 'assetTag', label: 'Asset tag' }, { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' }, { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' }, { key: 'replacementPlanDate', label: 'Replacement date' },
      ],
      rows: assets.map(assetRow),
    },
  };
}

const assetsReplacement = asyncHandler(async (req, res) => res.json(await buildAssetsReplacementReport(req)));

const assetsReplacementExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildAssetsReplacementReport(req);
  sendCsv(res, 'assets-replacement', tableData.columns, tableData.rows);
});

// GET /reports/assets/warranty — expired + expiring-soon (90 days) warranties.
async function buildAssetsWarrantyReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = { warrantyExpiryDate: { [Op.ne]: null } };
  if (deptId) where.departmentId = deptId;
  if (req.query.startDate || req.query.endDate) {
    Object.assign(where, dateWhere('warrantyExpiryDate', parseDateRange(req.query)));
  }

  const assets = await Asset.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: assetInclude, order: [['warrantyExpiryDate', 'ASC']] });
  const todayStr = new Date().toISOString().slice(0, 10);
  const in90Str = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const expired = assets.filter((a) => a.warrantyExpiryDate < todayStr).length;
  const expiringSoon = assets.filter((a) => a.warrantyExpiryDate >= todayStr && a.warrantyExpiryDate <= in90Str).length;

  return {
    summary: { total: assets.length, expired, expiringSoon },
    tableData: {
      columns: [
        { key: 'assetTag', label: 'Asset tag' }, { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' }, { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' }, { key: 'warrantyExpiryDate', label: 'Warranty expiry' },
      ],
      rows: assets.map(assetRow),
    },
  };
}

const assetsWarranty = asyncHandler(async (req, res) => res.json(await buildAssetsWarrantyReport(req)));

const assetsWarrantyExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildAssetsWarrantyReport(req);
  sendCsv(res, 'assets-warranty', tableData.columns, tableData.rows);
});

// GET /reports/assets/inventory — full inventory list, filterable by
// department/category/status.
async function buildAssetsInventoryReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const where = {};
  if (deptId) where.departmentId = deptId;
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.status) where.status = req.query.status;

  const assets = await Asset.findAll({ where: andWhere(where, await companyFilterWhere(req.user, req.query.companyId)), include: assetInclude, order: [['assetTag', 'ASC']] });
  const byCategory = new Map();
  const byStatus = new Map();
  assets.forEach((a) => {
    const catName = a.category?.name || 'Uncategorized';
    byCategory.set(catName, (byCategory.get(catName) || 0) + 1);
    byStatus.set(a.status, (byStatus.get(a.status) || 0) + 1);
  });

  return {
    summary: { total: assets.length },
    chartData: {
      byCategory: [...byCategory.entries()].map(([name, count]) => ({ name, count })),
      byStatus: [...byStatus.entries()].map(([name, count]) => ({ name, count })),
    },
    tableData: {
      columns: [
        { key: 'assetTag', label: 'Asset tag' }, { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' }, { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' },
        { key: 'warrantyExpiryDate', label: 'Warranty expiry' }, { key: 'replacementPlanDate', label: 'Replacement date' },
      ],
      rows: assets.map(assetRow),
    },
  };
}

const assetsInventory = asyncHandler(async (req, res) => res.json(await buildAssetsInventoryReport(req)));

const assetsInventoryExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildAssetsInventoryReport(req);
  sendCsv(res, 'assets-inventory', tableData.columns, tableData.rows);
});

// GET /reports/assets/ticket-history — which assets generate the most tickets.
async function buildAssetsTicketHistoryReport(req) {
  const deptId = await resolveReportDeptId(req, parseDepartmentId(req.query));
  const range = parseDateRange(req.query);

  const linkWhere = {};
  if (range.start || range.end) Object.assign(linkWhere, dateWhere('linkedAt', range));

  const links = await AssetTicket.findAll({
    where: linkWhere,
    include: [{
      model: Asset,
      as: 'asset',
      required: true,
      where: andWhere(deptId ? { departmentId: deptId } : {}, await companyFilterWhere(req.user, req.query.companyId)),
      include: assetInclude,
    }],
  });

  const byAsset = new Map();
  links.forEach((l) => {
    const a = l.asset;
    const cur = byAsset.get(a.id) || { ...assetRow(a), ticketCount: 0 };
    cur.ticketCount += 1;
    byAsset.set(a.id, cur);
  });

  const rows = [...byAsset.values()].sort((a, b) => b.ticketCount - a.ticketCount);

  return {
    summary: { totalLinkedTickets: links.length, assetsWithTickets: rows.length },
    chartData: {
      topAssets: rows.slice(0, 10).map((r) => ({ name: r.assetTag, count: r.ticketCount })),
    },
    tableData: {
      columns: [
        { key: 'assetTag', label: 'Asset tag' }, { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' }, { key: 'department', label: 'Department' },
        { key: 'ticketCount', label: 'Tickets linked' },
      ],
      rows,
    },
  };
}

const assetsTicketHistory = asyncHandler(async (req, res) => res.json(await buildAssetsTicketHistoryReport(req)));

const assetsTicketHistoryExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildAssetsTicketHistoryReport(req);
  sendCsv(res, 'assets-ticket-history', tableData.columns, tableData.rows);
});

module.exports = {
  assetsReplacement,
  assetsReplacementExport,
  assetsWarranty,
  assetsWarrantyExport,
  assetsInventory,
  assetsInventoryExport,
  assetsTicketHistory,
  assetsTicketHistoryExport,
};
