// The Microsoft 365 sync (client portal 7b): keeps a company's contacts in
// step with the people in its sync groups. Nightly (syncScheduler.js) and on
// demand (Sync now).
//
// It only touches contacts that already exist. It never creates or deletes:
//   link     an unlinked contact of this company whose AD object GUID matches
//            the person's on-premises immutable id, or whose email matches;
//            linking turns portal access on and clears any password, as a
//            Microsoft sign-in does
//   update   a linked contact's name, email, phone (business, else mobile),
//            job title and Microsoft 365 department name, then the PRISM
//            department that name resolves to (departments.js)
//   inactive a linked contact disabled in Microsoft 365, or no longer in any
//            sync group, is made inactive (never reactivated: staff do that)
// When any group could not be read (consent withdrawn, an outage), the member
// list is incomplete, so nobody is made inactive for being missing from it.
const { Op } = require('sequelize');
const { Company, Contact } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const graph = require('./graph');
const { recountDetected, applyDepartments } = require('./departments');
const { destroyPortalSessions } = require('../portal/sessions');

const MAX_ERRORS = 50;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// One sync per company at a time (PRISM runs as a single backend instance,
// like the other schedulers).
const running = new Set();
const isRunning = (companyId) => running.has(Number(companyId));

const describe = (err) => (err.name === 'GraphError' ? `${err.status || 'no response'}${err.code ? `, ${err.code}` : ''}` : err.message);
const emailOf = (u) => [u.mail, u.userPrincipalName].find((v) => typeof v === 'string' && EMAIL.test(v.trim()))?.trim() || null;
const lower = (v) => (v ? String(v).toLowerCase() : v);
// AD's objectGUID, as adContactSync stores it (hex of the raw bytes), from
// Entra's onPremisesImmutableId (base64 of the same bytes).
function immutableIdToGuidHex(value) {
  if (typeof value !== 'string' || !value) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 16 ? bytes.toString('hex') : null;
}

// The contact fields Microsoft 365 owns, from a Graph user.
function fieldsFrom(user, contact) {
  const first = (user.givenName || user.displayName || contact.firstName || '').trim();
  const fields = {
    firstName: first.slice(0, 100) || contact.firstName,
    lastName: (user.givenName ? user.surname || '' : contact.lastName || '').trim().slice(0, 100),
    displayName: (user.displayName || [user.givenName, user.surname].filter(Boolean).join(' ') || contact.displayName).trim().slice(0, 200),
    phone: ((user.businessPhones || [])[0] || user.mobilePhone || contact.phone || null),
    jobTitle: user.jobTitle ? String(user.jobTitle).slice(0, 150) : null,
    msDepartmentName: user.department ? String(user.department).trim().slice(0, 150) : null,
  };
  const email = emailOf(user);
  if (email) fields.email = email;
  if (fields.phone) fields.phone = String(fields.phone).slice(0, 50);
  return fields;
}

async function runSync(company, result) {
  const tenantId = company.msTenantId;
  const groups = (company.msSyncGroups || []).filter((g) => g && g.id);
  if (!tenantId || !groups.length) {
    result.errors.push(tenantId ? 'No sync groups chosen' : 'No Microsoft 365 tenant linked');
    return;
  }

  // 1. Everyone in the sync groups, once each.
  const members = new Map();
  let complete = true;
  for (const group of groups) {
    try {
      for await (const user of graph.listGroupMembers(tenantId, group.id)) members.set(user.id.toLowerCase(), user);
    } catch (err) {
      complete = false;
      result.errors.push(`Could not read the group "${group.name || group.id}" (${describe(err)})`);
    }
  }
  // A group read proves the tenant approved the app.
  if (complete && !company.msConsentAt) await company.update({ msConsentAt: new Date() });

  const contacts = await Contact.scope('withPassword').findAll({ where: { companyId: company.id } });
  const byOid = new Map(contacts.filter((c) => c.msObjectId).map((c) => [c.msObjectId.toLowerCase(), c]));
  const unlinked = contacts.filter((c) => !c.msObjectId);
  const byGuid = new Map(unlinked.filter((c) => c.adObjectGUID).map((c) => [c.adObjectGUID.toLowerCase(), c]));
  const byEmail = new Map(unlinked.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));

  // 2. Link unlinked contacts to members not seen before.
  for (const [oid, user] of members) {
    if (byOid.has(oid)) continue; // eslint-disable-line no-continue
    const guid = immutableIdToGuidHex(user.onPremisesImmutableId);
    const email = lower(emailOf(user));
    const contact = (guid && byGuid.get(guid)) || (email && byEmail.get(email));
    if (!contact) continue; // eslint-disable-line no-continue
    if (contact.msObjectId) {
      result.errors.push(`${user.displayName || oid} matches ${contact.email || contact.displayName}, already linked to another Microsoft person`);
      continue; // eslint-disable-line no-continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await contact.update({ msObjectId: oid, portalAccess: true, passwordHash: null });
      // Sessions from their old password end with it (a Microsoft sign-in
      // starts one that is re-checked every 15 minutes).
      await destroyPortalSessions(contact.id); // eslint-disable-line no-await-in-loop
      byOid.set(oid, contact);
    } catch (err) {
      result.errors.push(`Could not link ${contact.email || contact.displayName}: ${err.message}`);
    }
  }

  // 3. Bring linked members up to date; 4. make the rest inactive.
  for (const [oid, contact] of byOid) {
    const user = members.get(oid);
    if (!user) {
      if (complete && contact.status === 'active') {
        await contact.update({ status: 'inactive' }); // eslint-disable-line no-await-in-loop
        // eslint-disable-next-line no-await-in-loop
        await writeAudit({ user: null }, 'portal.access_ended_by_directory', 'Contact', contact.id, { reason: 'not_in_groups', via: 'sync' });
        result.deactivated += 1;
      }
      continue; // eslint-disable-line no-continue
    }
    const fields = fieldsFrom(user, contact);
    if (user.accountEnabled === false && contact.status === 'active') fields.status = 'inactive';
    const changed = Object.keys(fields).filter((k) => (contact[k] ?? null) !== (fields[k] ?? null));
    if (!changed.length) continue; // eslint-disable-line no-continue
    try {
      await contact.update(Object.fromEntries(changed.map((k) => [k, fields[k]]))); // eslint-disable-line no-await-in-loop
    } catch (err) {
      await contact.reload(); // eslint-disable-line no-await-in-loop
      const what = err.name === 'SequelizeUniqueConstraintError' ? `the email ${fields.email} is already another contact's` : err.message;
      result.errors.push(`Could not update ${contact.displayName}: ${what}`);
      continue; // eslint-disable-line no-continue
    }
    if (fields.status === 'inactive') {
      // eslint-disable-next-line no-await-in-loop
      await writeAudit({ user: null }, 'portal.access_ended_by_directory', 'Contact', contact.id, { reason: 'disabled', via: 'sync' });
      result.deactivated += 1;
    } else {
      result.updated += 1;
    }
  }

  // 5. Department names: the to-do list (from every member, so only when
  // every group was read), then contacts whose name resolves get it.
  if (complete) result.newDetected = await recountDetected(company.id, [...members.values()]);
  result.departmentsAssigned = await applyDepartments(company.id);
}

// Syncs one company and saves the summary to Company.msLastSync.
// → { at, durationMs, updated, deactivated, newDetected, errors }
// Throws 409 SYNC_RUNNING while that company's sync is already running.
async function syncCompany(companyId) {
  const id = Number(companyId);
  if (running.has(id)) throw new ApiError(409, 'A Microsoft 365 sync of this company is already running', 'SYNC_RUNNING');
  running.add(id);
  const started = Date.now();
  const result = {
    at: new Date(started).toISOString(), durationMs: 0, updated: 0, deactivated: 0, newDetected: 0, departmentsAssigned: 0, errors: [],
  };
  try {
    const company = await Company.findByPk(id);
    if (!company) throw new ApiError(404, 'Company not found', 'NOT_FOUND');
    try {
      await runSync(company, result);
    } catch (err) {
      result.errors.push(`The sync stopped: ${describe(err)}`);
    }
    result.durationMs = Date.now() - started;
    if (result.errors.length > MAX_ERRORS) result.errors = [...result.errors.slice(0, MAX_ERRORS), `…and ${result.errors.length - MAX_ERRORS} more`];
    await Company.update({ msLastSync: result }, { where: { id } });
    return result;
  } finally {
    running.delete(id);
  }
}

// Companies the nightly run syncs: linked, with sync groups, active.
const syncableCompanies = () => Company.findAll({
  where: { msTenantId: { [Op.ne]: null }, status: 'active' },
}).then((rows) => rows.filter((c) => (c.msSyncGroups || []).length));

module.exports = {
  syncCompany, isRunning, syncableCompanies, immutableIdToGuidHex,
};
