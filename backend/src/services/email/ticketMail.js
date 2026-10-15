// Sends one templated email about a ticket (spec 5a): fills the ticket,
// contact, technician and comment placeholders, threads it with a
// ticket-encoding Message-ID, and skips it when the template is switched off.
const { SystemSettings, User, Contact } = require('../../models');
const { sendMail } = require('../emailSender');
const { render, TRUSTED_HTML } = require('./templates');
const { textToHtml } = require('../../utils/richHtml');
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

// Returns what was sent, or null when the template is off or there is
// nobody to send to. Throws on a send failure: callers queue it (below).
async function sendTicketEmail(key, {
  ticket, comment, author, contact, to, cc, bcc, extra,
}) {
  const recipients = { to: list(to), cc: list(cc), bcc: list(bcc) };
  if (!recipients.to.length && !recipients.cc.length && !recipients.bcc.length) return null;
  const out = await render(key, await ticketContext({
    ticket, comment, author, contact, extra,
  }));
  if (!out.enabled) return null;
  const fromRow = await SystemSettings.findOne({ where: { key: 'smtp.fromEmail' } });
  const mail = {
    to: recipients.to,
    ...(recipients.cc.length ? { cc: recipients.cc } : {}),
    ...(recipients.bcc.length ? { bcc: recipients.bcc } : {}),
    subject: out.subject,
    html: out.html,
    text: out.text,
    attachments: out.attachments,
    headers: { 'X-PRISM-Ticket-ID': ticketNumber(ticket.id) },
    messageId: buildTicketMessageId(ticket.id, fromRow?.value),
  };
  await sendMail(mail);
  return mail;
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
  buildTicketMessageId, ticketNumber, ticketUrl, ticketContext, sendTicketEmail, queueTicketEmail, queueContactEmail,
};
