// Company helpers shared by controllers and services. The internal company is
// created by the client-companies migration and can never be deleted, so its
// id is cached for the life of the process.
const { Company, Department, Site } = require('../models');

let internalCompanyId = null;

async function getInternalCompanyId({ transaction } = {}) {
  if (internalCompanyId) return internalCompanyId;
  const row = await Company.findOne({ where: { isInternal: true }, attributes: ['id'], transaction });
  if (!row) throw new Error('No internal company — run the client-companies migration');
  internalCompanyId = row.id;
  return internalCompanyId;
}

// Free-mail domains never identify a company (spec: Data model → CompanyDomains).
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'fastmail.com',
]);

// A department that exists and belongs to companyId, or null. Missing and
// foreign look the same, so callers answer both with one message.
async function findDepartmentInCompany(departmentId, companyId) {
  const { parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  const id = parseRecordId(departmentId);
  if (!id) return null;
  const dept = await Department.findByPk(id);
  return dept && dept.companyId === companyId ? dept : null;
}

// An active site that belongs to companyId, or null (missing, inactive and
// foreign look the same).
async function findSiteInCompany(siteId, companyId) {
  const { parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  const id = parseRecordId(siteId);
  if (!id) return null;
  const site = await Site.findByPk(id);
  return site && site.companyId === companyId && site.status === 'active' ? site : null;
}

// The company a new or moved record goes in. Absent means the internal
// company. Otherwise it must exist, be active, be a client or the internal
// company, and be reachable by the user — anything else (missing,
// vendor-only, inactive, out of reach) gets the same 400, so the field can't
// be used to probe which companies exist.
async function resolveRecordCompany(user, rawCompanyId) {
  const { canAccessCompany, parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  if (rawCompanyId === undefined || rawCompanyId === null || rawCompanyId === '') {
    return Company.findByPk(await getInternalCompanyId());
  }
  const company = await Company.findByPk(parseRecordId(rawCompanyId) || 0);
  const usable = company && company.status === 'active' && (company.isClient || company.isInternal)
    && (await canAccessCompany(user, company.id));
  if (!usable) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  return company;
}

module.exports = {
  getInternalCompanyId, FREE_MAIL_DOMAINS, findDepartmentInCompany, findSiteInCompany, resolveRecordCompany,
};
