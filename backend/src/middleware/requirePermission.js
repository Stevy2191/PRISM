// Permission-based authorization. Use after `authenticate`.
const { ApiError } = require('./error');
const { hasAnyPermission } = require('../services/permissionService');

// requirePermission('tickets.create') — requires that single permission.
// requirePermission('tickets.view_own', 'tickets.view_department', 'tickets.view_all')
//   — requires ANY of the given permissions (use for "X minimum" routes where
//   scope filtering, not the route guard, narrows what's actually returned).
function requirePermission(...permissionKeys) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new ApiError(401, 'Authentication required', 'UNAUTHENTICATED'));
      }
      const allowed = await hasAnyPermission(req.user.id, permissionKeys);
      if (!allowed) {
        return next(new ApiError(403, 'Insufficient permissions', 'FORBIDDEN', { required: permissionKeys[0] }));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requirePermission };
