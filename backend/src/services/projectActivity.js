// Per-project activity timeline (Activity tab). Mirrors ticketActivity.js,
// but stores a JSON `detail` blob instead of resolved fromValue/toValue
// strings, since project events vary more in shape.
const { ProjectActivity } = require('../models');

async function logProjectActivity(projectId, userId, action, detail = null) {
  return ProjectActivity.create({ projectId, userId: userId || null, action, detail });
}

module.exports = { logProjectActivity };
