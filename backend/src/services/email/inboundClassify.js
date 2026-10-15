// Inbound email matching (spec 5a, "Inbound matching"): which ticket a
// message is about, and what to do with it. Pure, so every branch is
// unit-tested on its own; services/inboundEmailService.js gathers the facts.
const { parseRecordId } = require('../permissionService');

// A ticket id from "[Ticket #N]" in the subject, then from PRISM's own
// Message-IDs in the threading headers, then from a standalone "#N" (after
// the start, a space or "[", before the end, a space, "]" or ":").
// { id, loose } — loose = only the bare "#N" matched. Ticket numbers are
// sequential, so "Invoice #4471" names a real ticket by chance: a loose
// match counts only for that ticket's own contact or CC list (user decision
// 2026-10-15).
function findTicketRef(subject, inReplyTo, references) {
  const subj = String(subject || '');
  const bracket = parseRecordId((/\[Ticket #0*(\d{1,15})\]/i.exec(subj) || [])[1]);
  if (bracket) return { id: bracket, loose: false };

  const refList = Array.isArray(references) ? references : (references ? [references] : []);
  // eslint-disable-next-line no-restricted-syntax
  for (const header of [inReplyTo, ...refList].filter(Boolean)) {
    const m = /prism-ticket-(\d{1,15})-/i.exec(String(header));
    const id = m && parseRecordId(m[1]);
    if (id) return { id, loose: false };
  }

  const loose = parseRecordId((/(?:^|[\s[])#0*(\d{1,15})(?=$|[\s\]:])/.exec(subj) || [])[1]);
  return loose ? { id: loose, loose: true } : null;
}

function findTicketNumber(subject, inReplyTo, references) {
  const ref = findTicketRef(subject, inReplyTo, references);
  return ref ? ref.id : null;
}

// senderKind: 'contact_side' (the ticket's contact or on its CC list),
// 'staff' (an active PRISM user) or 'other'.
function classifyInbound({
  ticketFound, senderKind, verified, staffCanEdit, hasCustomerRecipient,
}) {
  if (ticketFound) {
    if (senderKind === 'contact_side') return 'reply_added';
    if (senderKind === 'staff') return verified && staffCanEdit ? 'staff_reply_added' : 'unverified_note';
    return 'ticket_created';
  }
  if (senderKind === 'staff') {
    if (!hasCustomerRecipient) return 'ignored';
    return verified ? 'staff_ticket_created' : 'staff_ticket_unverified';
  }
  return 'ticket_created';
}

module.exports = { findTicketNumber, findTicketRef, classifyInbound };
