// Authentication middleware.
// Accepts either a session cookie (browser clients) or an X-API-Key header.
const { User, Role } = require('../models');
const { resolveApiKey: resolveKey } = require('../services/apiKeys');
const { ApiError } = require('./error');
const { userIdForGrant } = require('../mcp/internalApi');
const { noteOwnerLevel } = require('../services/permissionService');

// Included on every req.user so the frontend can show the new roles system's
// primary role name instead of the legacy `role` enum (see Role model).
const primaryRoleInclude = [{ model: Role, as: 'primaryRole' }];

// Resolve the acting user from the session or API key and attach to req.user.
async function authenticate(req, res, next) {
  try {
    // 0. /mcp's tools on the internal listener (mcp/internalApi): a grant
    // that lives only while its MCP request runs. Ignored on PRISM's public
    // side, where req.prismInternal is never set.
    if (req.prismInternal && req.get('X-PRISM-MCP-Grant')) {
      const userId = userIdForGrant(req.get('X-PRISM-MCP-Grant'));
      const user = userId ? await User.findByPk(userId, { include: primaryRoleInclude }) : null;
      if (!user || !user.isActive) {
        return next(new ApiError(401, 'This Claude request has ended', 'UNAUTHENTICATED'));
      }
      noteOwnerLevel(user);
      req.user = user;
      req.authMethod = 'mcp';
      return next();
    }

    // 1. API key auth
    const apiKeyHeader = req.get('X-API-Key');
    if (apiKeyHeader) {
      const user = await resolveApiKey(apiKeyHeader);
      if (!user) {
        return next(new ApiError(401, 'Invalid or expired API key', 'INVALID_API_KEY'));
      }
      noteOwnerLevel(user);
      req.user = user;
      req.authMethod = 'apikey';
      return next();
    }

    // 2. Session auth
    if (req.session && req.session.userId) {
      const user = await User.findByPk(req.session.userId, {
        attributes: { exclude: [] },
        include: primaryRoleInclude,
      });
      if (!user) {
        return next(new ApiError(401, 'Session user no longer exists', 'UNAUTHENTICATED'));
      }
      if (!user.isActive) {
        return next(new ApiError(401, 'This account has been deactivated', 'ACCOUNT_DEACTIVATED'));
      }
      noteOwnerLevel(user);
      req.user = user;
      req.authMethod = 'session';
      return next();
    }

    return next(new ApiError(401, 'Authentication required', 'UNAUTHENTICATED'));
  } catch (err) {
    return next(err);
  }
}

// The active user an API key belongs to, or null (services/apiKeys).
function resolveApiKey(plaintext) {
  return resolveKey(plaintext, { userInclude: primaryRoleInclude });
}

module.exports = { authenticate, resolveApiKey };
