const { Permission } = require('../models');
const { asyncHandler } = require('../middleware/error');

// GET /permissions — the full permission catalog (key/category/label/description),
// with no role or user context. Powers the "new role" editor (no role id yet
// to scope a per-role permission list) and the override-creation permission
// picker on a user's detail page.
const list = asyncHandler(async (req, res) => {
  const permissions = await Permission.findAll({ order: [['category', 'ASC'], ['id', 'ASC']] });
  res.json({ permissions });
});

module.exports = { list };
