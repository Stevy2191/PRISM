// Inbound email matching (spec 5a, "Inbound matching"): which ticket a
// message is about, and what to do with it. Pure, so every branch is
// unit-tested on its own; services/inboundEmailService.js gathers the facts.
const { parseRecordId } = require('../permissionService');

// A ticket id from the subject, then from PRISM's own Message-IDs in the
// threading headers. Subject: "[Ticket #N]" first, then a standalone "#N"
// (after the start, a space or "[", before the end, a space, "]" or ":").
function findTicketNumber(subject, inReplyTo, references) {
  const subj = String(subject || '');
  const bracket = /\[Ticket #0*(\d{1,15})\]/i.exec(subj);
  const loose = bracket ? null : /(?:^|[\s[])#0*(\d{1,15})(?=$|[\s\]:])/.exec(subj);
  const fromSubject = parseRecordId((bracket || loose || [])[1]);
  if (fromSubject) return fromSubject;

  const refList = Array.isArray(references) ? references : (references ? [references] : []);
  // eslint-disable-next-line no-restricted-syntax
  for (const header of [inReplyTo, ...refList].filter(Boolean)) {
    const m = /prism-ticket-(\d{1,15})-/i.exec(String(header));
    const id = m && parseRecordId(m[1]);
    if (id) return id;
  }
  return null;
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

module.exports = { findTicketNumber, classifyInbound };
