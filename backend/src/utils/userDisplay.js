// Resolves a User's display name, preferring firstName+lastName over
// whatever fallback (existing displayName/username) the caller supplies.
// Used at write time (see usersController) to keep the `displayName` column
// itself correct — every existing read call site across the app already
// reads `.displayName` directly, so keeping that column in sync means none
// of those call sites need to change to pick up the new name fields.
function computeDisplayName({ firstName, lastName, fallback }) {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  return fallback;
}

module.exports = { computeDisplayName };
