// Tickets controller index. The handlers live in ./tickets/, one module per
// area; this file keeps the original import path and export names.
module.exports = {
  ...require('./tickets/core'),
  ...require('./tickets/comments'),
  ...require('./tickets/attachments'),
  ...require('./tickets/time'),
  ...require('./tickets/relations'),
  ...require('./tickets/csat'),
  ...require('./tickets/watchers'),
  ...require('./tickets/tasks'),
  ...require('./tickets/fields'),
  ...require('./tickets/activity'),
};
