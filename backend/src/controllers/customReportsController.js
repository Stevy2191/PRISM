const { SavedCustomReport } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { getSourceMetadata, runCustomReport, FIELD_DEFS } = require('../services/customReportEngine');
const { csvCell } = require('./reportsController');
const {
  newDocument, drawHeader, sectionTitle, table, barChart, streamPdfResponse,
} = require('../services/pdfReport');

const DATA_SOURCE_LABELS = {
  tickets: 'Tickets', projects: 'Projects', time_entries: 'Time Entries',
  expenses_materials: 'Expenses & Materials', contacts: 'Contacts',
};

// GET /reports/custom/metadata — field/filter/groupBy options per data
// source, so the frontend wizard doesn't hardcode this in two places.
const metadata = asyncHandler(async (req, res) => {
  res.json(await getSourceMetadata());
});

// POST /reports/custom — { dataSource, fields, filters, groupBy, visualization }
const run = asyncHandler(async (req, res) => {
  const { dataSource } = req.body || {};
  if (!FIELD_DEFS[dataSource]) throw new ApiError(400, 'Invalid dataSource', 'VALIDATION_ERROR');
  const result = await runCustomReport(req);
  res.json(result);
});

// POST /reports/custom/export-csv
const exportCsv = asyncHandler(async (req, res) => {
  const { dataSource } = req.body || {};
  if (!FIELD_DEFS[dataSource]) throw new ApiError(400, 'Invalid dataSource', 'VALIDATION_ERROR');
  const { tableData } = await runCustomReport(req);
  const lines = [tableData.columns.map((c) => csvCell(c.label)).join(',')];
  tableData.rows.forEach((row) => {
    lines.push(tableData.columns.map((c) => csvCell(row[c.key])).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="prism-custom-report-${dataSource}.csv"`);
  res.send(lines.join('\r\n'));
});

// POST /reports/custom/export-pdf
const exportPdf = asyncHandler(async (req, res) => {
  const { dataSource, groupBy, visualization } = req.body || {};
  if (!FIELD_DEFS[dataSource]) throw new ApiError(400, 'Invalid dataSource', 'VALIDATION_ERROR');
  const { tableData, chartData, summary } = await runCustomReport(req);

  const doc = newDocument();
  await streamPdfResponse(res, `prism-custom-report-${dataSource}.pdf`, doc, async (d) => {
    await drawHeader(d, 'Custom Report');
    sectionTitle(d, `${DATA_SOURCE_LABELS[dataSource] || dataSource}${groupBy ? ` — grouped by ${groupBy}` : ''}`);
    d.fontSize(9).fillColor('#64748b').text(`${summary.totalRecords} record${summary.totalRecords === 1 ? '' : 's'}`, { width: 512 });
    d.moveDown(0.5);

    if (chartData.length && visualization && visualization !== 'table') {
      sectionTitle(d, 'Chart');
      const valueKey = Object.keys(chartData[0]).find((k) => k !== 'name') || 'count';
      barChart(d, chartData, valueKey);
    }

    sectionTitle(d, 'Data');
    const colWidth = Math.max(60, Math.floor(512 / Math.max(1, tableData.columns.length)));
    table(d, tableData.columns.map((c) => ({ key: c.key, label: c.label, width: colWidth })), tableData.rows, { rowHeight: 16 });
  });
});

// ---- Saved custom reports ----

// GET /reports/saved
const listSaved = asyncHandler(async (req, res) => {
  const reports = await SavedCustomReport.findAll({ where: { userId: req.user.id }, order: [['updatedAt', 'DESC']] });
  res.json({ reports });
});

// POST /reports/saved — { name, dataSource, fields, filters, groupBy, visualization }
const createSaved = asyncHandler(async (req, res) => {
  const { name, dataSource, fields, filters, groupBy, visualization } = req.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
  if (!FIELD_DEFS[dataSource]) throw new ApiError(400, 'Invalid dataSource', 'VALIDATION_ERROR');
  const report = await SavedCustomReport.create({
    userId: req.user.id,
    name: name.trim(),
    dataSource,
    fields: Array.isArray(fields) ? fields : [],
    filters: filters || {},
    groupBy: groupBy || null,
    visualization: visualization || 'table',
  });
  res.status(201).json({ report });
});

// PATCH /reports/saved/:id — edit an existing saved configuration
const updateSaved = asyncHandler(async (req, res) => {
  const report = await SavedCustomReport.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!report) throw new ApiError(404, 'Saved report not found', 'NOT_FOUND');
  const { name, fields, filters, groupBy, visualization } = req.body || {};
  const changes = {};
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
    changes.name = name.trim();
  }
  if (fields !== undefined) changes.fields = fields;
  if (filters !== undefined) changes.filters = filters;
  if (groupBy !== undefined) changes.groupBy = groupBy || null;
  if (visualization !== undefined) changes.visualization = visualization;
  await report.update(changes);
  res.json({ report });
});

// POST /reports/saved/:id/run — runs the saved config and stamps lastRunAt
const runSaved = asyncHandler(async (req, res) => {
  const report = await SavedCustomReport.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!report) throw new ApiError(404, 'Saved report not found', 'NOT_FOUND');
  const fakeReq = {
    user: req.user,
    body: {
      dataSource: report.dataSource,
      fields: report.fields,
      // Current date filter (if any) from the request body overrides the
      // saved filters — "run with current date filter" per spec.
      filters: { ...report.filters, ...(req.body?.filters || {}) },
      groupBy: report.groupBy,
    },
  };
  const result = await runCustomReport(fakeReq);
  await report.update({ lastRunAt: new Date() });
  res.json({ ...result, report });
});

// DELETE /reports/saved/:id
const removeSaved = asyncHandler(async (req, res) => {
  const report = await SavedCustomReport.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!report) throw new ApiError(404, 'Saved report not found', 'NOT_FOUND');
  await report.destroy();
  res.json({ ok: true });
});

module.exports = {
  metadata, run, exportCsv, exportPdf, listSaved, createSaved, updateSaved, runSaved, removeSaved,
};
