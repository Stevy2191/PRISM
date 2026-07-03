const { SavedFilter } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');

// GET /saved-filters — the logged-in user's own saved filter combinations.
const list = asyncHandler(async (req, res) => {
  const savedFilters = await SavedFilter.findAll({
    where: { userId: req.user.id },
    order: [['createdAt', 'ASC']],
  });
  res.json({ savedFilters });
});

// POST /saved-filters { name, filterJson }
const create = asyncHandler(async (req, res) => {
  const { name, filterJson } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Filter name is required', 'VALIDATION_ERROR');
  }
  if (!filterJson || typeof filterJson !== 'object' || Array.isArray(filterJson)) {
    throw new ApiError(400, 'filterJson must be an object', 'VALIDATION_ERROR');
  }
  const savedFilter = await SavedFilter.create({
    userId: req.user.id,
    name: name.trim(),
    filterJson,
  });
  res.status(201).json({ savedFilter });
});

// DELETE /saved-filters/:id — own filters only.
const remove = asyncHandler(async (req, res) => {
  const savedFilter = await SavedFilter.findOne({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!savedFilter) throw new ApiError(404, 'Saved filter not found', 'NOT_FOUND');
  await savedFilter.destroy();
  res.json({ ok: true });
});

module.exports = { list, create, remove };
