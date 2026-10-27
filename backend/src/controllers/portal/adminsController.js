// Staff: who is a portal admin of a company or a department (spec 7,
// Admins). Reading needs sight of the company's people; changing needs
// portal.manage (route) and the caller's company access. A department admin
// must be a contact of that department, a company admin of that company.
const { Op } = require('sequelize');
const {
  Company, Department, Contact, CompanyPortalAdmin, DepartmentPortalAdmin, sequelize,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { canAccessCompany, parseRecordId } = require('../../services/permissionService');
const { PICK } = require('../../services/portal/adminRoles');
const { displayName } = require('./authController');

const MAX_ADMINS = 200;

async function loadReachable(Model, req, what) {
  const record = await Model.findByPk(parseRecordId(req.params.id) || 0);
  if (!record) throw new ApiError(404, `${what} not found`, 'NOT_FOUND');
  const companyId = Model === Company ? record.id : record.companyId;
  if (!(await canAccessCompany(req.user, companyId))) throw new ApiError(403, `You do not have access to this ${what.toLowerCase()}`, 'FORBIDDEN');
  return record;
}

function parseContactIds(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_ADMINS) throw new ApiError(400, 'contactIds must be a list of contacts', 'VALIDATION_ERROR');
  const ids = raw.map(parseRecordId);
  if (ids.some((id) => !id)) throw new ApiError(400, 'Contact not found', 'VALIDATION_ERROR');
  return [...new Set(ids)];
}

const contactJson = (c) => ({
  id: c.id, displayName: displayName(c), email: c.email, departmentId: c.departmentId, status: c.status, portalAccess: c.portalAccess,
});

async function adminsOf(Join, where) {
  const rows = await Join.findAll({ where, include: [{ model: Contact, as: 'contact', attributes: PICK }], order: [['id', 'ASC']] });
  return rows.filter((r) => r.contact).map((r) => contactJson(r.contact));
}

// Replaces the admin set. `memberWhere` is what a contact must match to be one.
async function replaceAdmins(req, { Join, key, record, memberWhere, entityType }) {
  const ids = parseContactIds((req.body || {}).contactIds);
  if (ids.length) {
    const members = await Contact.count({ where: { id: { [Op.in]: ids }, ...memberWhere } });
    if (members !== ids.length) {
      throw new ApiError(400, `Only contacts of this ${entityType.toLowerCase()} can be its portal admins`, 'VALIDATION_ERROR');
    }
  }
  await sequelize.transaction(async (transaction) => {
    await Join.destroy({ where: { [key]: record.id, ...(ids.length ? { contactId: { [Op.notIn]: ids } } : {}) }, transaction });
    const have = new Set((await Join.findAll({ where: { [key]: record.id }, attributes: ['contactId'], transaction })).map((r) => r.contactId));
    const add = ids.filter((id) => !have.has(id)).map((contactId) => ({ [key]: record.id, contactId }));
    if (add.length) await Join.bulkCreate(add, { transaction });
  });
  await writeAudit(req, 'portal.admins_changed', entityType, record.id, { contactIds: ids });
  return adminsOf(Join, { [key]: record.id });
}

const listCompanyAdmins = asyncHandler(async (req, res) => {
  const company = await loadReachable(Company, req, 'Company');
  res.json({ contacts: await adminsOf(CompanyPortalAdmin, { companyId: company.id }) });
});

const setCompanyAdmins = asyncHandler(async (req, res) => {
  const company = await loadReachable(Company, req, 'Company');
  const contacts = await replaceAdmins(req, {
    Join: CompanyPortalAdmin, key: 'companyId', record: company, memberWhere: { companyId: company.id }, entityType: 'Company',
  });
  res.json({ contacts });
});

const listDepartmentAdmins = asyncHandler(async (req, res) => {
  const department = await loadReachable(Department, req, 'Department');
  res.json({ contacts: await adminsOf(DepartmentPortalAdmin, { departmentId: department.id }) });
});

const setDepartmentAdmins = asyncHandler(async (req, res) => {
  const department = await loadReachable(Department, req, 'Department');
  const contacts = await replaceAdmins(req, {
    Join: DepartmentPortalAdmin,
    key: 'departmentId',
    record: department,
    memberWhere: { departmentId: department.id, companyId: department.companyId },
    entityType: 'Department',
  });
  res.json({ contacts });
});

module.exports = {
  listCompanyAdmins, setCompanyAdmins, listDepartmentAdmins, setDepartmentAdmins,
};
