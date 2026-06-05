// Role-based authorization. Use after `authenticate`.
const { ApiError } = require('./error');

// requireRole('admin') or requireRole('admin', 'technician')
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required', 'UNAUTHENTICATED'));
    }
    if (!allowed.includes(req.user.role)) {
      return next(
        new ApiError(403, 'You do not have permission to perform this action', 'FORBIDDEN')
      );
    }
    return next();
  };
}

const isAdmin = (user) => user && user.role === 'admin';
const isStaff = (user) => user && (user.role === 'admin' || user.role === 'technician');

module.exports = { requireRole, isAdmin, isStaff };
