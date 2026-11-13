// A signed-in user's own screen choices (migration 087). Only ever the
// caller's rows: there is no user id in these addresses.
const { UserPreference } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');

// The screens that keep a choice, and how large one may be.
const KEYS = new Set(['tickets.columns']);
const MAX_BYTES = 16 * 1024;

function keyOf(req) {
  const { key } = req.params;
  if (!KEYS.has(key)) throw new ApiError(404, 'Unknown preference', 'NOT_FOUND');
  return key;
}

// GET /preferences/:key → { value } (null when never set)
const get = asyncHandler(async (req, res) => {
  const row = await UserPreference.findOne({ where: { userId: req.user.id, key: keyOf(req) } });
  res.json({ value: row ? row.value : null });
});

// PUT /preferences/:key { value }
const put = asyncHandler(async (req, res) => {
  const key = keyOf(req);
  const { value } = req.body || {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'value must be an object', 'VALIDATION_ERROR');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new ApiError(400, 'That is too much to save', 'VALIDATION_ERROR');
  const [row, created] = await UserPreference.findOrCreate({ where: { userId: req.user.id, key }, defaults: { value } });
  if (!created) await row.update({ value });
  res.json({ value });
});

// DELETE /preferences/:key: back to the screen's default
const remove = asyncHandler(async (req, res) => {
  await UserPreference.destroy({ where: { userId: req.user.id, key: keyOf(req) } });
  res.json({ value: null });
});

module.exports = { get, put, remove };
