// router.param('id') callback for routers whose records carry companyId but
// whose handlers fetch by raw id (assets, licenses, contracts). Refusing here
// covers every current and future /:id route on the router at once, and runs
// before any route middleware (uploads included).
const { ApiError } = require('./error');
const { canAccessCompany, parseRecordId } = require('../services/permissionService');

function fenceParam(Model, label) {
  const notFound = `${label.charAt(0).toUpperCase()}${label.slice(1)} not found`;
  return async (req, res, next, rawId) => {
    try {
      const id = parseRecordId(rawId);
      // Anything but a plain positive integer is answered here: MariaDB casts
      // '1abc' to 1, so letting the handler look it up would skip the fence.
      if (!id) return next(new ApiError(404, notFound, 'NOT_FOUND'));
      const record = await Model.findByPk(id, { attributes: ['id', 'companyId'] });
      if (record && !(await canAccessCompany(req.user, record.companyId))) {
        return next(new ApiError(403, `You do not have access to this ${label}`, 'FORBIDDEN'));
      }
      return next(); // a missing record gets the handler's own 404
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { fenceParam };
