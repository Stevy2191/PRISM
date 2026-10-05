// The people working a ticket must be able to open it (plan 2b decision):
// an assignee or watcher who can't reach the ticket's company would get its
// title and comments in notifications. Assignments made before this rule
// (or before a contact moved company) are left as they are.
const { User } = require('../models');
const { ApiError } = require('../middleware/error');
const { canAccessCompany, parseRecordId } = require('./permissionService');

async function canWorkCompany(userId, companyId) {
  const user = await User.findByPk(parseRecordId(userId) || 0, { attributes: ['id', 'role', 'roleId', 'allCompanies', 'isActive'] });
  return user && user.isActive && (await canAccessCompany(user, companyId)) ? user : null;
}

async function assertCanWorkTicket(userId, companyId, label) {
  const user = await canWorkCompany(userId, companyId);
  if (!user) throw new ApiError(400, `${label} can't see tickets for this company`, 'VALIDATION_ERROR');
  return user.id;
}

module.exports = { canWorkCompany, assertCanWorkTicket };
