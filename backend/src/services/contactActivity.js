const { ContactActivity } = require('../models');

// Appends one entry to a contact's Activity tab timeline.
async function logContactActivity(contactId, userId, action, detail = null) {
  return ContactActivity.create({ contactId, userId, action, detail });
}

module.exports = { logContactActivity };
