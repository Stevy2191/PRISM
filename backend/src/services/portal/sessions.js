// Ending a contact's portal sessions. Same approach as the staff side: match
// the stored session JSON.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../models');

// Revoke every stored portal session of a contact except keepSid: after a
// password reset, and when a contact is linked to Microsoft (7b), so a
// session that began with their old password doesn't outlive it (and escape
// the 15-minute Microsoft re-check).
async function destroyPortalSessions(contactId, keepSid) {
  const rows = await sequelize.query('SELECT sid, data FROM Sessions', { type: QueryTypes.SELECT });
  const stale = rows.filter((row) => {
    if (row.sid === keepSid) return false;
    try { return JSON.parse(row.data)?.contactId === contactId; } catch { return false; }
  }).map((row) => row.sid);
  if (stale.length) await sequelize.query('DELETE FROM Sessions WHERE sid IN (:sids)', { replacements: { sids: stale } });
  return stale.length;
}

module.exports = { destroyPortalSessions };
