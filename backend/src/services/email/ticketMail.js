// Sends one templated email about a ticket (spec 5a): fills the ticket,
// contact, technician and comment placeholders, threads it with a
// ticket-encoding Message-ID, and skips it when the template is switched off.
const { SystemSettings, User, Contact } = require('../../models');
const { sendMail } = require('../emailSender');
const { render, TRUSTED_HTML } = require('./templates');
const { CATALOG } = require('./catalog');
const { textToHtml, escapeHtml } = require('../../utils/richHtml');
const { surveyBaseUrl } = require('../csatService');

// Every outbound email about a ticket gets a Message-ID that encodes the
// ticket id, so replies to it (In-Reply-To/References) can be matched back
// to the ticket without a separate lookup table.
function ticketDomain(fromEmail) {
  const at = String(fromEmail || '').split('@')[1];
  return at || 'prism.local';
}
function buildTicketMessageId(ticketId, fromEmail) {
  return `<prism-ticket-${ticketId}-${Date.now()}@${ticketDomain(fromEmail)}>`;
}

// PRISM's own mailboxes: never a recipient, never a customer.
async function ownAddresses() {
  const rows = await SystemSettings.findAll({ where: { key: ['inboundEmail.address', 'smtp.fromEmail'] } });
  return rows.map((r) => String(r.value || '').trim().toLowerCase()).filter(Boolean);
}

const ticketNumber = (id) => String(id).padStart(5, '0');
const ticketUrl = (id) => `${surveyBaseUrl()}/tickets/${id}`;

// The placeholder values for a ticket email. `extra` adds key-specific
// values (survey links, a notification message).
async function ticketContext({
  ticket, comment, author, contact, extra,
}) {
  const person = contact || (ticket.contactId ? await Contact.findByPk(ticket.contactId) : null);
  const techId = author ? author.id : ticket.assigneeId;
  const tech = techId ? await User.findByPk(techId, { attributes: ['id', 'displayName', 'emailSignature'] }) : null;
  const context = {
    ticket: {
      number: ticketNumber(ticket.id),
      title: ticket.title,
      url: ticketUrl(ticket.id),
      status: ticket.status,
      priority: ticket.priority,
    },
    contact: person ? {
      firstName: person.firstName || person.displayName || '',
      name: person.displayName || [person.firstName, person.lastName].filter(Boolean).join(' '),
    } : {},
    tech: { name: tech ? tech.displayName : '' },
    comment: { body: comment ? comment.body : '' },
    // Stored sanitized (users controller), so it may go in as HTML.
    signature: author && tech ? tech.emailSignature || '' : '',
    ...extra,
  };
  // A reply's text is shown as typed: escaped, line breaks kept.
  if (comment) context[TRUSTED_HTML] = { 'comment.body': textToHtml(comment.body) };
  return context;
}

const list = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);

// Client portal (7a): which of these addresses belong to a contact who can
// open this ticket in the portal (portal on, contact active with access,
// ticket in their scope). Only they get the "View in the portal" link.
async function portalLinkAddresses(ticket, addresses) {
  if (!addresses.length) return new Set();
  /* eslint-disable global-require */
  const { isPortalEnabled, mayUsePortal } = require('../../middleware/portalAuth');
  const { canSeeTicket } = require('../portal/scope');
  /* eslint-enable global-require */
  if (!(await isPortalEnabled())) return new Set();
  const contacts = await Contact.findAll({ where: { email: addresses, status: 'active', portalAccess: true } });
  const out = new Set();
  for (const c of contacts) {
    // eslint-disable-next-line no-await-in-loop
    if (mayUsePortal(c) && (await canSeeTicket(c, ticket.id))) out.add(String(c.email).toLowerCase());
  }
  return out;
}

const portalFooter = (ticketId) => {
  const url = `${surveyBaseUrl()}/portal/tickets/${ticketId}`;
  return {
    html: `<p style="margin-top:20px"><a href="${escapeHtml(url)}">View this request in the portal</a></p>`,
    text: `View this request in the portal: ${url}`,
  };
};

// Returns what was sent, or null when the template is off or there is
// nobody to send to. Throws on a send failure: callers queue it (below).
// A customer email goes out as at most two copies with the same To/Cc
// headers: one with the portal link (delivered to those who can see the
// ticket there) and one without (everyone else).
async function sendTicketEmail(key, {
  ticket, comment, author, contact, to, cc, bcc, extra,
}) {
  const recipients = { to: list(to), cc: list(cc), bcc: list(bcc) };
  const everyone = [...recipients.to, ...recipients.cc, ...recipients.bcc];
  if (!everyone.length) return null;
  const context = await ticketContext({
    ticket, comment, author, contact, extra,
  });
  const out = await render(key, context);
  if (!out.enabled) return null;
  const linked = CATALOG[key]?.audience === 'contact' ? await portalLinkAddresses(ticket, everyone) : new Set();
  const withLink = everyone.filter((a) => linked.has(String(a).toLowerCase()));
  const without = everyone.filter((a) => !linked.has(String(a).toLowerCase()));
  const fromRow = await SystemSettings.findOne({ where: { key: 'smtp.fromEmail' } });
  const base = {
    to: recipients.to,
    ...(recipients.cc.length ? { cc: recipients.cc } : {}),
    subject: out.subject,
    attachments: out.attachments,
    headers: { 'X-PRISM-Ticket-ID': ticketNumber(ticket.id) },
  };
  const copy = (rendered, envelopeTo) => ({
    ...base,
    ...(envelopeTo ? { envelopeTo } : (recipients.bcc.length ? { bcc: recipients.bcc } : {})),
    html: rendered.html,
    text: rendered.text,
    messageId: buildTicketMessageId(ticket.id, fromRow?.value),
  });
  if (!withLink.length) {
    const mail = copy(out, null);
    await sendMail(mail);
    return mail;
  }
  const linkedOut = await render(key, context, undefined, { footer: portalFooter(ticket.id) });
  const linkedMail = copy(linkedOut, without.length ? withLink : null);
  await sendMail(linkedMail);
  if (without.length) await sendMail(copy(out, without));
  return linkedMail;
}

// Outbound mail never blocks or fails the request that caused it: it runs
// after the response path, and a failure is only logged.
function queueTicketEmail(key, options) {
  setImmediate(() => {
    sendTicketEmail(key, options).catch((err) => {
      console.error(`[email] ${key} failed for ticket ${options.ticket && options.ticket.id}:`, err.message);
    });
  });
}

// Queues a contact-facing email to the ticket's contact, looked up when
// the job runs (nothing to do if the ticket has no contact email).
function queueContactEmail(key, ticket) {
  setImmediate(async () => {
    try {
      const contact = ticket.contactId ? await Contact.findByPk(ticket.contactId) : null;
      if (contact && contact.email) await sendTicketEmail(key, { ticket, contact, to: [contact.email] });
    } catch (err) {
      console.error(`[email] ${key} failed for ticket ${ticket.id}:`, err.message);
    }
  });
}

module.exports = {
  buildTicketMessageId, ownAddresses, ticketNumber, ticketUrl, ticketContext, sendTicketEmail, queueTicketEmail, queueContactEmail,
};
