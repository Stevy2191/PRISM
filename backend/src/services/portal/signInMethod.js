// How a contact signs in to the portal, from a row loaded with passwordHash
// and msObjectId (Contact.scope('withPassword')): 'microsoft' once linked to
// a Microsoft 365 account (7b), else 'password' once one is set, else null
// (not signed in yet).
function signInMethod(row) {
  if (!row) return null;
  if (row.msObjectId) return 'microsoft';
  return row.passwordHash ? 'password' : null;
}

module.exports = { signInMethod };
