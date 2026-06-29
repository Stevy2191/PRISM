const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ApiKey, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

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

// POST /apikeys — generate key, return plaintext once, store bcrypt hash
const create = asyncHandler(async (req, res) => {
  const { name, expiresAt } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'API key name is required', 'VALIDATION_ERROR');
  }

  // Plaintext key: prism_<32 random hex bytes>. An 8-char prefix of the secret
  // (after the constant "prism_" tag) is stored to narrow bcrypt candidates on
  // lookup; the full key is bcrypt-hashed and never stored.
  const secret = crypto.randomBytes(32).toString('hex');
  const plaintext = `prism_${secret}`;
  const prefix = plaintext.slice(6, 14); // 8 hex chars of entropy, skipping the "prism_" tag
  const keyHash = await bcrypt.hash(plaintext, 12);

  const apiKey = await ApiKey.create({
    name: name.trim(),
    keyHash,
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
  await apiKey.destroy();
  await writeAudit(req, 'apikey.delete', 'ApiKey', apiKey.id, { name: apiKey.name });
  res.json({ ok: true });
});

module.exports = { list, create, remove };
