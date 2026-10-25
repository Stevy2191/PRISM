// Per-ticket activity timeline (Activity tab). Stores resolved, human-readable
// display values so the frontend can render rows directly without extra lookups.
const { TicketActivity, User, Team, Department, Ticket } = require('../models');
const { canAccessTicket } = require('./permissionService');

async function logActivity(ticketId, userId, action, fromValue = null, toValue = null) {
  return TicketActivity.create({ ticketId, userId: userId || null, action, fromValue, toValue });
}

// Activity rows as a viewer may see them (Q18 for the timeline). A link row
// stores the linked ticket's id (fromValue) and the link type (toValue); its
// title is shown only to someone who can open that ticket. Rows written
// before that carry the title itself, so they show no title at all.
async function shownActivity(viewer, rows) {
  return Promise.all(rows.map(async (row) => {
    const json = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
    if (json.action !== 'relation_added') return json;
    const linkedId = /^\d+$/.test(json.fromValue || '') ? Number(json.fromValue) : null;
    if (!linkedId) return { ...json, toValue: `${String(json.toValue || '').split(': ')[0]}: a linked ticket` };
    const linked = await Ticket.findByPk(linkedId, { attributes: ['id', 'title', 'departmentId', 'assigneeId', 'companyId'] });
    const label = `#${String(linkedId).padStart(5, '0')}`;
    const shown = linked && viewer && (await canAccessTicket(viewer, linked)) ? `${label} ${linked.title}` : `${label} (restricted)`;
    return { ...json, fromValue: null, toValue: `${json.toValue}: ${shown}` };
  }));
}

// Resolves a raw field value to a display string for the activity log.
// `field` matches the Ticket column name (assigneeId, teamId, departmentId, ...).
async function resolveDisplayValue(field, value, { categoryTree = null } = {}) {
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
  if (field === 'categoryId') {
    // Lazy: the category service loads the models this file is loaded beside.
    const { loadTree, pathOf } = require('./tickets/categories'); // eslint-disable-line global-require
    const path = pathOf(categoryTree || await loadTree(), value);
    return path.length ? path.map((n) => n.name).join(' › ') : `Category #${value}`;
  }
  return String(value).replace(/_/g, ' ');
}

module.exports = { logActivity, resolveDisplayValue, shownActivity };
