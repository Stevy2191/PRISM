const { SavedReportView } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');

// GET /reports/saved-views?reportType=ticket-volume — the logged-in user's
// own saved views, optionally scoped to one report.
const list = asyncHandler(async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.reportType) where.reportType = req.query.reportType;
  const savedViews = await SavedReportView.findAll({ where, order: [['createdAt', 'ASC']] });
  res.json({ savedViews });
});

// POST /reports/saved-views { reportType, name, filters }
const create = asyncHandler(async (req, res) => {
  const { reportType, name, filters } = req.body || {};
  if (!reportType || !String(reportType).trim()) {
    throw new ApiError(400, 'reportType is required', 'VALIDATION_ERROR');
  }
  if (!name || !name.trim()) {
    throw new ApiError(400, 'View name is required', 'VALIDATION_ERROR');
  }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new ApiError(400, 'filters must be an object', 'VALIDATION_ERROR');
  }
  const savedView = await SavedReportView.create({
    userId: req.user.id,
    reportType: reportType.trim(),
    name: name.trim(),
    filters,
  });
  res.status(201).json({ savedView });
});

// DELETE /reports/saved-views/:id — own views only.
const remove = asyncHandler(async (req, res) => {
  const savedView = await SavedReportView.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!savedView) throw new ApiError(404, 'Saved view not found', 'NOT_FOUND');
  await savedView.destroy();
  res.json({ ok: true });
});

module.exports = { list, create, remove };
