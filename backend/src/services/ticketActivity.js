// Per-ticket activity timeline (Activity tab). Stores resolved, human-readable
// display values so the frontend can render rows directly without extra lookups.
const { TicketActivity, User, Team, Department } = require('../models');

async function logActivity(ticketId, userId, action, fromValue = null, toValue = null) {
  return TicketActivity.create({ ticketId, userId: userId || null, action, fromValue, toValue });
}

// Resolves a raw field value to a display string for the activity log.
// `field` matches the Ticket column name (assigneeId, teamId, departmentId, ...).
async function resolveDisplayValue(field, value) {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'assigneeId') {
    const user = await User.findByPk(value);
    return user ? user.displayName : `User #${value}`;
  }
  if (field === 'teamId') {
    const team = await Team.findByPk(value);
    return team ? team.name : `Team #${value}`;
  }
  if (field === 'departmentId') {
    const dept = await Department.findByPk(value);
    return dept ? dept.name : `Department #${value}`;
  }
  return String(value).replace(/_/g, ' ');
}

module.exports = { logActivity, resolveDisplayValue };
