// Shared user/contact display-name + avatar-initials helpers — consolidates
// what used to be 8 byte-for-byte-identical local `initials()` copies across
// the app (Contacts.jsx, ContactDetail.jsx, Tickets.jsx, TicketDetail.jsx,
// TicketNew.jsx, Projects.jsx, ProjectDetail.jsx, navConfig.js).

// Resolves a person's display name, preferring firstName+lastName over
// whatever the record's own displayName/username already is. Mirrors the
// backend's computeDisplayName (backend/src/utils/userDisplay.js) — that one
// keeps the `displayName` column itself in sync at write time, so most read
// call sites never need this; it's for the few spots (e.g. a live profile
// form preview) that need to resolve a name from in-progress edits.
export function resolveUserName(person) {
  if (!person) return '';
  if (person.firstName || person.lastName) {
    return [person.firstName, person.lastName].filter(Boolean).join(' ');
  }
  return person.displayName || person.username || '';
}

// Accepts either a plain display-name string (the original call shape, still
// used everywhere that only has a name in scope — e.g. a ticket's assignee)
// or a user/contact-like object (when a firstName/lastName/username-aware
// fallback matters, e.g. the logged-in user's own avatar).
export function initials(nameOrPerson) {
  if (nameOrPerson && typeof nameOrPerson === 'object') {
    const { firstName, lastName, username, displayName } = nameOrPerson;
    if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
    if (firstName) return firstName.slice(0, 2).toUpperCase();
    if (displayName) return initials(displayName);
    if (username) return username.slice(0, 2).toUpperCase();
    return '?';
  }
  const parts = String(nameOrPerson || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
