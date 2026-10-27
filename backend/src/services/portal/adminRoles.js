// Portal admin roles follow the person (spec 7, Admins): a department admin
// role only holds for the contact's current department, a company admin role
// only for their current company. Called after a contact's department or
// company changes (the Contact afterUpdate hook covers every staff path, and
// 7b's sync), it drops whatever no longer matches.
const { Op } = require('sequelize');
const { CompanyPortalAdmin, DepartmentPortalAdmin } = require('../../models');

async function pruneAdminRoles(contact, { transaction } = {}) {
  const deptWhere = { contactId: contact.id };
  if (contact.departmentId != null) deptWhere.departmentId = { [Op.ne]: contact.departmentId };
  await DepartmentPortalAdmin.destroy({ where: deptWhere, transaction });
  await CompanyPortalAdmin.destroy({ where: { contactId: contact.id, companyId: { [Op.ne]: contact.companyId } }, transaction });
}

// Admin lists for the company / department pages.
const PICK = ['id', 'firstName', 'lastName', 'displayName', 'email', 'departmentId', 'status', 'portalAccess'];

module.exports = { pruneAdminRoles, PICK };
