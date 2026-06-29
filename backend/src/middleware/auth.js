// Authentication middleware.
// Accepts either a session cookie (browser clients) or an X-API-Key header.
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, ApiKey } = require('../models');
const { ApiError } = require('./error');

// Resolve the acting user from the session or API key and attach to req.user.
async function authenticate(req, res, next) {
  try {
    // 1. API key auth
    const apiKeyHeader = req.get('X-API-Key');
    if (apiKeyHeader) {
      const user = await resolveApiKey(apiKeyHeader);
      if (!user) {
        return next(new ApiError(401, 'Invalid or expired API key', 'INVALID_API_KEY'));
      }
      req.user = user;
      req.authMethod = 'apikey';
      return next();
    }

    // 2. Session auth
    if (req.session && req.session.userId) {
      const user = await User.findByPk(req.session.userId, {
        attributes: { exclude: [] },
      });
      if (!user) {
        return next(new ApiError(401, 'Session user no longer exists', 'UNAUTHENTICATED'));
      }
      req.user = user;
      req.authMethod = 'session';
      return next();
    }

    return next(new ApiError(401, 'Authentication required', 'UNAUTHENTICATED'));
  } catch (err) {
    return next(err);
  }
}

// Validate a plaintext API key against stored bcrypt hashes.
async function resolveApiKey(plaintext) {
  // Keys carry an 8-char prefix of the secret hex (after "prism_") to narrow
  // candidates before the expensive bcrypt compare.
  const prefix = plaintext.slice(6, 14);
  const candidates = await ApiKey.findAll({
    where: {
      prefix,
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
    },
    include: [{ model: User, as: 'user' }],
  });

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const match = await bcrypt.compare(plaintext, candidate.keyHash);
    if (match && candidate.user) {
      candidate.lastUsed = new Date();
      await candidate.save();
      return candidate.user;
    }
  }
  return null;
}

module.exports = { authenticate, resolveApiKey };
