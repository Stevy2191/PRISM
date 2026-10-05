// The one definition of "which tickets / projects / contacts may this user
// list". Lists, search, the calendar and the dashboard all build their WHERE
// from here, so the company fence (and any future scope rule) is applied in
// one place. Single records are checked by permissionService.canAccess*.
const { Op } = require('sequelize');
const { ProjectMember } = require('../models');
const {
  getUserTicketScope, getUserProjectScope, hasPermission, companyScopeWhere, parseRecordId,
} = require('./permissionService');

function isEmpty(where) {
  return !where || (Object.keys(where).length === 0 && Object.getOwnPropertySymbols(where).length === 0);
}

// AND-joins where fragments. Never spread scope into a where: a filter's
// Op.or (or a plain key like departmentId) would silently replace the scope's.
function andWhere(...parts) {
  const real = parts.filter((p) => !isEmpty(p));
  if (!real.length) return {};
  return real.length === 1 ? real[0] : { [Op.and]: real };
}

async function ticketScopeWhere(user) {
  const [company, scope] = await Promise.all([companyScopeWhere(user), getUserTicketScope(user.id)]);
  let tier = {};
  if (scope === 'department') tier = { [Op.or]: [{ departmentId: user.departmentId }, { assigneeId: user.id }] };
  else if (scope === 'own') tier = { assigneeId: user.id };
  return andWhere(company, tier);
}

async function projectScopeWhere(user) {
  const [company, scope] = await Promise.all([companyScopeWhere(user), getUserProjectScope(user.id)]);
  if (scope === 'all') return company;
  const memberships = await ProjectMember.findAll({ where: { userId: user.id }, attributes: ['projectId'], raw: true });
  const memberIds = memberships.map((m) => m.projectId);
  let tier;
  if (scope === 'department') {
    const or = [{ ownerDepartmentId: user.departmentId }, { forDepartmentId: user.departmentId }];
    if (memberIds.length) or.push({ id: { [Op.in]: memberIds } });
    tier = { [Op.or]: or };
  } else {
    tier = memberIds.length ? { id: { [Op.in]: memberIds } } : { id: -1 };
  }
  return andWhere(company, tier);
}

async function contactScopeWhere(user) {
  const [company, viewAll] = await Promise.all([companyScopeWhere(user), hasPermission(user.id, 'people.view_all')]);
  return andWhere(company, viewAll ? {} : { departmentId: user.departmentId });
}

// The viewer's company fence, narrowed to one company when a filter names
// one (?companyId= on reports). A filter only ever narrows: a junk id
// matches nothing, and an unreachable company ANDs to nothing.
async function companyFilterWhere(user, rawCompanyId, column = 'companyId') {
  const fence = await companyScopeWhere(user, column);
  if (rawCompanyId === undefined || rawCompanyId === null || rawCompanyId === '') return fence;
  return andWhere(fence, { [column]: parseRecordId(rawCompanyId) || -1 });
}

module.exports = {
  companyFilterWhere,
  isEmpty, andWhere, ticketScopeWhere, projectScopeWhere, contactScopeWhere,
};
