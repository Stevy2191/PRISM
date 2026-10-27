// What a signed-in contact may see in the client portal. Every portal query
// goes through here, so there is one place to get it right.
//
// Tickets, in scopes:
//   mine        the contact's own, plus the ones they raised for someone else
//   watching    tickets they were added to as a watcher
//   department  every ticket of a department they're an admin of (by the
//               ticket's customer department)
//   company     every ticket of their company, if they're a company admin
//   all         the union
// Everything is also fenced to the contact's own company: an admin or watcher
// row pointing elsewhere (stale after a move, or bad data) opens nothing.
const { Op } = require('sequelize');
const {
  sequelize, Ticket, Contact, Department, TicketWatcher, CompanyPortalAdmin, DepartmentPortalAdmin,
} = require('../../models');
const { parseRecordId } = require('../permissionService');

const SCOPES = ['all', 'mine', 'watching', 'department', 'company'];
const NOTHING = { id: { [Op.in]: [] } };

async function isCompanyAdmin(contact) {
  return !!(await CompanyPortalAdmin.findOne({ where: { contactId: contact.id, companyId: contact.companyId } }));
}

// Departments this contact is an admin of, within their own company.
async function adminDepartmentIds(contact) {
  const rows = await DepartmentPortalAdmin.findAll({
    where: { contactId: contact.id },
    include: [{
      model: Department, as: 'department', attributes: [], where: { companyId: contact.companyId }, required: true,
    }],
    attributes: ['departmentId'],
  });
  return rows.map((r) => r.departmentId);
}

async function portalTicketWhere(contact, scope = 'all') {
  if (!SCOPES.includes(scope)) return NOTHING;
  const want = (s) => scope === 'all' || scope === s;
  const parts = [];
  if (want('mine')) parts.push({ contactId: contact.id }, { portalCreatedByContactId: contact.id });
  if (want('watching')) {
    const rows = await TicketWatcher.findAll({ where: { contactId: contact.id }, attributes: ['ticketId'] });
    if (rows.length) parts.push({ id: rows.map((r) => r.ticketId) });
  }
  if (want('department')) {
    const deptIds = await adminDepartmentIds(contact);
    if (deptIds.length) parts.push({ departmentId: deptIds });
  }
  if (want('company') && (await isCompanyAdmin(contact))) parts.push({ companyId: contact.companyId });
  if (!parts.length) return NOTHING;
  return { [Op.and]: [{ companyId: contact.companyId }, { [Op.or]: parts }] };
}

async function canSeeTicket(contact, ticketId) {
  const id = parseRecordId(ticketId);
  if (!id) return false;
  return (await Ticket.count({ where: { [Op.and]: [{ id }, await portalTicketWhere(contact)] } })) > 0;
}

// Who this contact may raise a ticket for: themselves always; department
// admins also the active contacts of their departments; company admins every
// active contact of the company.
const PICK_ATTRS = ['id', 'firstName', 'lastName', 'displayName', 'email', 'departmentId', 'companyId'];
async function forContacts(contact) {
  const others = [];
  if (await isCompanyAdmin(contact)) {
    others.push({ companyId: contact.companyId });
  } else {
    const deptIds = await adminDepartmentIds(contact);
    if (deptIds.length) others.push({ companyId: contact.companyId, departmentId: deptIds });
  }
  const where = others.length
    ? { [Op.or]: [{ id: contact.id }, { [Op.and]: [{ status: 'active' }, { [Op.or]: others }] }] }
    : { id: contact.id };
  return Contact.findAll({
    where, attributes: PICK_ATTRS, order: [['lastName', 'ASC'], ['firstName', 'ASC'], ['id', 'ASC']],
  });
}

// Published portal articles this contact's audience covers. Ids are integers
// from the database, so inlining them in the subqueries is safe.
function portalArticleWhere(contact) {
  const audience = [{ portalScope: 'all' }];
  const companyId = Number(contact.companyId);
  if (Number.isInteger(companyId)) {
    audience.push({
      [Op.and]: [{ portalScope: 'companies' }, sequelize.literal(`\`KbArticle\`.\`id\` IN (SELECT articleId FROM KbArticleAudiences WHERE companyId = ${companyId})`)],
    });
  }
  const departmentId = contact.departmentId == null ? NaN : Number(contact.departmentId);
  if (Number.isInteger(departmentId)) {
    audience.push({
      [Op.and]: [{ portalScope: 'departments' }, sequelize.literal(`\`KbArticle\`.\`id\` IN (SELECT articleId FROM KbArticleAudiences WHERE departmentId = ${departmentId})`)],
    });
  }
  return { [Op.and]: [{ visibility: 'portal', status: 'published' }, { [Op.or]: audience }] };
}

module.exports = {
  SCOPES, portalTicketWhere, canSeeTicket, forContacts, portalArticleWhere, isCompanyAdmin, adminDepartmentIds,
};
