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

const isBlank = (value) => value === undefined || value === null || value === '';

// The company a new or moved record goes in. Absent means the internal
// company. Either way it must exist, be active, be a client or the internal
// company, and be reachable by the user — anything else (missing,
// vendor-only, inactive, out of reach) gets the same 400, so the field can't
// be used to probe which companies exist, and leaving it out can't place a
// record in a company the user can't reach.
async function resolveRecordCompany(user, rawCompanyId) {
  const { canAccessCompany, parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  const id = isBlank(rawCompanyId) ? await getInternalCompanyId() : parseRecordId(rawCompanyId);
  const company = await Company.findByPk(id || 0);
  const usable = company && company.status === 'active' && (company.isClient || company.isInternal)
    && (await canAccessCompany(user, company.id));
  if (!usable) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  return company;
}

// Whether an update's companyId asks to move the record. Blank (absent, null
// or '') means "leave it where it is": forms send null for an untouched
// picker, and that must never move a record (and its tickets) to the
// internal company.
function isCompanyChange(rawCompanyId, currentCompanyId) {
  const { parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  return !isBlank(rawCompanyId) && parseRecordId(rawCompanyId) !== currentCompanyId;
}

// Company-bound fields of an asset, license or contract that the body sets,
// checked against the record's company. `record` is null on create.
// `fields` names which apply: departmentId always, siteId and
// assignedToContactId for assets. Each one must sit in the record's company
// (and a contact must be one the user can see); missing, foreign and hidden
// all get the same 400. Moving company clears any of them the body doesn't
// set again, since they belonged to the old company. Returns the values to
// write, companyId included when it changes.
async function resolvePlacement(user, body, record, fields = ['departmentId']) {
  const { parseRecordId, findAccessibleContact } = require('./permissionService'); // eslint-disable-line global-require
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  const out = {};
  let companyId = record ? record.companyId : null;
  const moving = !record || isCompanyChange(body.companyId, record.companyId);
  if (moving) {
    companyId = (await resolveRecordCompany(user, body.companyId)).id;
    out.companyId = companyId;
  }
  const finders = {
    departmentId: ['Department', (id) => findDepartmentInCompany(id, companyId)],
    siteId: ['Site', (id) => findSiteInCompany(id, companyId)],
    assignedToContactId: ['Contact', async (id) => {
      const contact = await findAccessibleContact(user, id);
      return contact && contact.companyId === companyId ? contact : null;
    }],
  };
  for (const field of fields) {
    const [label, find] = finders[field];
    if (body[field] === undefined) {
      if (record && moving && record[field] != null) out[field] = null;
    } else if (body[field] === null || body[field] === '') {
      out[field] = null;
    } else if (record && !moving && parseRecordId(body[field]) === record[field]) {
      // Re-sending the current value (forms send the whole record back)
      // reveals and changes nothing, so it isn't re-checked.
    } else {
      const found = await find(body[field]); // eslint-disable-line no-await-in-loop
      if (!found) throw new ApiError(400, `${label} not found`, 'VALIDATION_ERROR');
      out[field] = found.id;
    }
  }
  return out;
}

module.exports = {
  getInternalCompanyId, FREE_MAIL_DOMAINS, findDepartmentInCompany, findSiteInCompany, resolveRecordCompany,
  resolvePlacement, isCompanyChange,
};
