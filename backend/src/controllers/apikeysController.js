const { ApiKey, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { assertCanManageAccount } = require('../services/ownership');
const { newApiKey } = require('../services/apiKeys');

// GET /apikeys — own keys; Admin sees all
const list = asyncHandler(async (req, res) => {
  const where = req.user.role === 'admin' ? {} : { userId: req.user.id };
  const keys = await ApiKey.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username'] }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ apiKeys: keys });
});

// POST /apikeys — generate key, return plaintext once, store its hash
const create = asyncHandler(async (req, res) => {
  const { name, expiresAt } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'API key name is required', 'VALIDATION_ERROR');
  }

  // prism_<32 random bytes in hex>, stored only as its SHA-256 (services/apiKeys).
  const { plaintext, prefix, lookupHash } = newApiKey();

  const apiKey = await ApiKey.create({
    name: name.trim(),
    lookupHash,
    prefix,
    userId: req.user.id,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });
  await writeAudit(req, 'apikey.create', 'ApiKey', apiKey.id, { name: apiKey.name });

  // Plaintext returned exactly once.
  res.status(201).json({ apiKey, key: plaintext });
});

// DELETE /apikeys/:id — owner or admin
const remove = asyncHandler(async (req, res) => {
  const apiKey = await ApiKey.findByPk(req.params.id);
  if (!apiKey) throw new ApiError(404, 'API key not found', 'NOT_FOUND');
  if (apiKey.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only revoke your own API keys', 'FORBIDDEN');
  }
  // Someone else's key belongs to their account: an administrator's only an
  // Owner may revoke (Owner review L2).
  if (apiKey.userId !== req.user.id) {
    const keyOwner = await User.findByPk(apiKey.userId);
    if (keyOwner) await assertCanManageAccount(req.user, keyOwner);
  }
  await apiKey.destroy();
  await writeAudit(req, 'apikey.delete', 'ApiKey', apiKey.id, { name: apiKey.name });
  res.json({ ok: true });
});

module.exports = { list, create, remove };
