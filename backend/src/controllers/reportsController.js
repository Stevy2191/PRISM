// Reports controller index. Builders live in ./reports/, one module per
// report family. The shared helpers below are part of this file's public
// surface (services/customReportEngine uses them); the rest of
// ./reports/shared stays internal.
const shared = require('./reports/shared');

const PUBLIC_HELPERS = [
  'parseDateRange', 'dateWhere', 'parseDepartmentId', 'parseAssigneeId', 'granularityFor', 'bucketKey',
  'ticketScopeWhere', 'projectScopeWhere', 'contactDeptWhere', 'sendCsv', 'hoursBetween', 'userAttrs',
];

module.exports = {
  ...Object.fromEntries(PUBLIC_HELPERS.map((name) => [name, shared[name]])),
  ...require('./reports/tickets'),
  ...require('./reports/team'),
  ...require('./reports/sla'),
  ...require('./reports/time'),
  ...require('./reports/projects'),
  ...require('./reports/contacts'),
  ...require('./reports/happiness'),
  ...require('./reports/assets'),
  ...require('./reports/licenses'),
};
