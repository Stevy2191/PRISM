// A ticket's number as people see it. Since CN each company numbers its own
// tickets (WC-T0042), shown as is; a number from before CN (00114) or a bare
// id is shown the old way, "#00114".
export function showTicketNumber(number) {
  const text = String(number ?? '');
  return /-T\d/.test(text) ? text : `#${text.padStart(5, '0')}`;
}

// Prefers the backend-supplied ticketNumber and falls back to the raw id.
export function formatTicketId(ticketOrId) {
  if (ticketOrId && typeof ticketOrId === 'object') {
    if (ticketOrId.ticketNumber) return showTicketNumber(ticketOrId.ticketNumber);
    if (ticketOrId.number) return showTicketNumber(ticketOrId.number);
    return showTicketNumber(ticketOrId.id);
  }
  return showTicketNumber(ticketOrId);
}
