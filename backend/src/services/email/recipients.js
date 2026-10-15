// Who a public reply is emailed to (spec 5a): the ticket's contact as To,
// the ticket's CC list plus the reply's one-off CC as Cc, and the one-off
// BCC as Bcc. Addresses are validated and de-duplicated across the fields
// (To wins over Cc over Bcc), and PRISM's own mailboxes are never sent to.
const { ApiError } = require('../../middleware/error');

const MAX_EXTRA = 20;

// The Contacts pattern, minus the characters a mailer reads as address-list
// or display-name syntax: "a,b@x.com" must not become two recipients.
const EMAIL = /^[^@\s,;<>"'()[\]\\:]+@[^@\s,;<>"'()[\]\\:]+\.[^@\s,;<>"'()[\]\\:]+$/;
const clean = (v) => String(v ?? '').trim().toLowerCase();
const isEmail = (v) => v.length <= 254 && EMAIL.test(v);

// Request input (a list, or one string separated by commas, semicolons or
// spaces) → lowercased, de-duplicated addresses. Anything invalid is a 400,
// so a typo is reported rather than silently not sent.
function normalizeEmailList(input) {
  if (input === undefined || input === null) return [];
  let parts;
  if (typeof input === 'string') parts = input.split(/[,;\s]+/);
  else if (Array.isArray(input) && input.every((v) => typeof v === 'string')) parts = input;
  else throw new ApiError(400, 'Email addresses must be a list of addresses', 'VALIDATION_ERROR');
  const out = [...new Set(parts.map(clean).filter(Boolean))];
  const bad = out.find((v) => !isEmail(v));
  if (bad) throw new ApiError(400, `Not a valid email address: ${bad.slice(0, 100)}`, 'VALIDATION_ERROR');
  if (out.length > MAX_EXTRA) throw new ApiError(400, `At most ${MAX_EXTRA} addresses`, 'VALIDATION_ERROR');
  return out;
}

// Pure. Stored addresses that are no longer valid are dropped, not refused.
function buildReplyRecipients({
  contactEmail, ccList = [], extraCc = [], extraBcc = [], ownAddresses = [],
}) {
  if (extraCc.length > MAX_EXTRA || extraBcc.length > MAX_EXTRA) {
    throw new ApiError(400, `At most ${MAX_EXTRA} Cc and ${MAX_EXTRA} Bcc addresses`, 'VALIDATION_ERROR');
  }
  const seen = new Set(ownAddresses.map(clean).filter(Boolean));
  const take = (list) => list.map(clean).filter((v) => {
    if (!isEmail(v) || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
  const to = take([contactEmail]);
  const cc = take([...ccList, ...extraCc]);
  const bcc = take(extraBcc);
  return { to, cc, bcc };
}

module.exports = {
  buildReplyRecipients, normalizeEmailList, isEmail, MAX_EXTRA,
};
