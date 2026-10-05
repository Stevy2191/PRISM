// Projects controller index. The handlers live in ./projects/, one module
// per area; this file keeps the original import path and export names.
module.exports = {
  ...require('./projects/core'),
  ...require('./projects/tasks'),
  ...require('./projects/time'),
  ...require('./projects/expenses'),
  ...require('./projects/materials'),
  ...require('./projects/members'),
  ...require('./projects/files'),
  ...require('./projects/activity'),
};
