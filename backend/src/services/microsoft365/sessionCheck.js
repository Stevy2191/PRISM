// A portal session started with Microsoft re-checks the person with
// Microsoft at least every 15 minutes (client portal 7b): their company still
// linked to the tenant they signed in from, their account still enabled, and
// still in one of the company's sync groups. Registered on portalAuth's
// portalSessionChecks, so it runs on every portal request; a request inside
// the 15 minutes costs nothing.
//
//   disabled, deleted or out of every sync group → contact made inactive
//     (audited portal.access_ended_by_directory), session ended
//   tenant unlinked or sync groups emptied → session ended, contact untouched
//   Microsoft unreachable → session kept (fail open for an outage), the check
//     tried again a minute later
const { Company, Contact } = require('../../models');
const { portalSessionChecks } = require('../../middleware/portalAuth');
const { writeAudit } = require('../../middleware/audit');
const graph = require('./graph');

const RECHECK_MS = 15 * 60 * 1000;
const OUTAGE_RETRY_MS = 60 * 1000;

// → 'ok' | 'ended'. Updates session.msCheckedAt when it asks Microsoft.
async function recheckMicrosoftSession(session, contact) {
  if (!session.msTenantId) return 'ok'; // a password session
  if (Date.now() - (session.msCheckedAt || 0) < RECHECK_MS) return 'ok';

  const company = await Company.findByPk(contact.companyId);
  const groupIds = ((company && company.msSyncGroups) || []).map((g) => g.id).filter(Boolean);
  if (!company || company.msTenantId !== session.msTenantId || !groupIds.length || !contact.msObjectId) return 'ended';

  let reason = null;
  try {
    const user = await graph.getUser(session.msTenantId, contact.msObjectId);
    if (!user) reason = 'deleted';
    else if (user.accountEnabled === false) reason = 'disabled';
    else if (!(await graph.memberOfAny(session.msTenantId, contact.msObjectId, groupIds))) reason = 'not_in_groups';
  } catch (err) {
    console.warn(`[portal] Microsoft re-check for contact ${contact.id} failed, keeping the session: ${err.message}`);
    session.msCheckedAt = Date.now() - RECHECK_MS + OUTAGE_RETRY_MS;
    return 'ok';
  }

  if (reason) {
    await Contact.update({ status: 'inactive' }, { where: { id: contact.id } });
    await writeAudit({ user: null }, 'portal.access_ended_by_directory', 'Contact', contact.id, { reason, tenantId: session.msTenantId });
    return 'ended';
  }
  session.msCheckedAt = Date.now();
  return 'ok';
}

portalSessionChecks.push(async (req, contact) => {
  if ((await recheckMicrosoftSession(req.session, contact)) === 'ended') throw new Error('Microsoft re-check ended the session');
});

module.exports = { recheckMicrosoftSession, RECHECK_MS };
