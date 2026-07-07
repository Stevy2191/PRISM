// Syncs PRISM Contacts from Active Directory, reusing the existing LDAP
// connection config (backend/src/config/ldap.js) — no separate AD connection
// is configured for this feature.
const { Op } = require('sequelize');
const {
  isConfigured, searchAllUsers, attr, attrAll, attrGuidHex, cnFromDn, isAccountDisabled,
} = require('../config/ldap');
const { Contact, AdSyncLog, AdGroupMapping } = require('../models');
const { logContactActivity } = require('../services/contactActivity');

// Resolves the department for an AD user from their group memberships —
// the first `memberOf` group (in the order AD returns them) that has a
// mapping wins; unmapped/no groups return null (department left untouched
// on update, unset on create).
function resolveDepartment(entry, groupMap) {
  const groups = attrAll(entry, 'memberOf');
  for (const dn of groups) {
    const cn = cnFromDn(dn);
    if (cn && groupMap.has(cn.toLowerCase())) return groupMap.get(cn.toLowerCase());
  }
  return null;
}

function attributesFromEntry(entry) {
  return {
    firstName: attr(entry, 'givenName') || attr(entry, 'displayName') || attr(entry, 'sAMAccountName') || null,
    lastName: attr(entry, 'sn') || '',
    email: attr(entry, 'mail') || null,
    phone: attr(entry, 'telephoneNumber') || null,
    // title first; AD's `department` attribute is a fallback source for job
    // title only (per spec) — it does not drive PRISM's departmentId, which
    // comes exclusively from group mapping.
    jobTitle: attr(entry, 'title') || attr(entry, 'department') || null,
    guid: attrGuidHex(entry),
    disabled: isAccountDisabled(attr(entry, 'userAccountControl')),
  };
}

async function findExistingContact(guid, email) {
  if (guid) {
    const byGuid = await Contact.findOne({ where: { adObjectGUID: guid } });
    if (byGuid) return byGuid;
  }
  if (email) {
    const contacts = await Contact.findAll({ where: { email: { [Op.ne]: null } } });
    const lower = email.toLowerCase();
    return contacts.find((c) => c.email && c.email.toLowerCase() === lower) || null;
  }
  return null;
}

async function deactivateContact(contact, counters) {
  if (contact.status === 'inactive') return; // already inactive — nothing to do
  // departmentId is left exactly as-is (preserved), tickets are untouched —
  // this call only ever changes `status` and sync bookkeeping fields.
  await contact.update({ status: 'inactive', adLastSynced: new Date() });
  await logContactActivity(contact.id, null, 'ad_deactivated', { displayName: contact.displayName });
  counters.contactsDeactivated += 1;
}

async function processEnabledUser(entry, groupMap, counters) {
  const a = attributesFromEntry(entry);
  if (!a.firstName && !a.email) return; // nothing usable to identify/create a contact with

  const departmentId = resolveDepartment(entry, groupMap);
  const existing = await findExistingContact(a.guid, a.email);

  if (existing) {
    await existing.update({
      firstName: a.firstName || existing.firstName,
      lastName: a.lastName,
      phone: a.phone,
      jobTitle: a.jobTitle,
      // Only overwrite department when a group mapping actually matched —
      // an unmapped/no-group user keeps whatever department it already had.
      departmentId: departmentId !== null ? departmentId : existing.departmentId,
      status: 'active',
      adSynced: true,
      adObjectGUID: a.guid || existing.adObjectGUID,
      adLastSynced: new Date(),
    });
    counters.contactsUpdated += 1;
    return existing.id;
  }

  const created = await Contact.create({
    firstName: a.firstName || '',
    lastName: a.lastName || '',
    displayName: `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
    email: a.email,
    phone: a.phone,
    jobTitle: a.jobTitle,
    departmentId,
    status: 'active',
    adSynced: true,
    adObjectGUID: a.guid,
    adLastSynced: new Date(),
  });
  await logContactActivity(created.id, null, 'ad_synced', { displayName: created.displayName });
  counters.contactsCreated += 1;
  return created.id;
}

// Runs one full sync pass. `triggeredBy`: 'manual' | 'scheduled'.
async function runAdContactSync(triggeredBy = 'scheduled') {
  const log = await AdSyncLog.create({ startedAt: new Date(), status: 'running', triggeredBy });

  const counters = { usersProcessed: 0, contactsCreated: 0, contactsUpdated: 0, contactsDeactivated: 0 };
  const errors = [];

  try {
    if (!isConfigured()) {
      throw Object.assign(new Error('LDAP is not configured'), { code: 'LDAP_NOT_CONFIGURED' });
    }

    const [entries, mappings] = await Promise.all([
      searchAllUsers(),
      AdGroupMapping.findAll(),
    ]);
    const groupMap = new Map(mappings.map((m) => [m.adGroupName.toLowerCase(), m.departmentId]));

    const seenContactIds = new Set();

    // eslint-disable-next-line no-restricted-syntax
    for (const entry of entries) {
      counters.usersProcessed += 1;
      try {
        const a = attributesFromEntry(entry);
        if (a.disabled) {
          // eslint-disable-next-line no-await-in-loop
          const existing = await findExistingContact(a.guid, a.email);
          if (existing && existing.adSynced) {
            // eslint-disable-next-line no-await-in-loop
            await deactivateContact(existing, counters);
            seenContactIds.add(existing.id);
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          const id = await processEnabledUser(entry, groupMap, counters);
          if (id) seenContactIds.add(id);
        }
      } catch (err) {
        errors.push({ entry: attr(entry, 'sAMAccountName') || attr(entry, 'dn') || 'unknown', message: err.message });
      }
    }

    // Anyone previously synced from AD but absent from this run's results —
    // deleted from AD entirely (not just disabled, which is handled above).
    const staleContacts = await Contact.findAll({ where: { adSynced: true, status: 'active' } });
    // eslint-disable-next-line no-restricted-syntax
    for (const contact of staleContacts) {
      if (seenContactIds.has(contact.id)) continue; // eslint-disable-line no-continue
      try {
        // eslint-disable-next-line no-await-in-loop
        await deactivateContact(contact, counters);
      } catch (err) {
        errors.push({ entry: contact.displayName, message: err.message });
      }
    }

    await log.update({
      completedAt: new Date(),
      status: 'success',
      ...counters,
      errorDetails: errors.length ? errors : null,
    });
  } catch (err) {
    await log.update({
      completedAt: new Date(),
      status: 'failed',
      ...counters,
      errorDetails: [{ entry: null, message: err.message }],
    });
    throw err;
  }

  return log;
}

module.exports = { runAdContactSync };
