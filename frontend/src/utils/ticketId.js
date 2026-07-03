// Zero-padded 5-digit ticket display id, e.g. 114 -> "#00114".
// Prefers a backend-supplied ticketNumber (already zero-padded) and falls
// back to formatting the raw numeric id so any endpoint that hasn't been
// updated to include ticketNumber still renders consistently.
export function formatTicketId(ticketOrId) {
  if (ticketOrId && typeof ticketOrId === 'object') {
    if (ticketOrId.ticketNumber) return `#${ticketOrId.ticketNumber}`;
    return `#${String(ticketOrId.id).padStart(5, '0')}`;
  }
  return `#${String(ticketOrId).padStart(5, '0')}`;
}
