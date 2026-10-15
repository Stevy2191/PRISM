// Automated, contact-facing CSAT survey system — creates a pending
// CsatSurvey row when a ticket transitions into a closed-behavior status
// (hooked from ticketsController.js's update handler), and builds the
// survey email itself. Actual sending (respecting the configured delay) is
// done by csatScheduler.js, not here — this module only decides "should a
// survey exist" and "what would the email look like."
//
// Distinct from the older CsatResponse model (staff-entered happy/neutral/
// unhappy "on the contact's behalf") — this is the real thing, a token-based
// link a contact clicks themselves, no login required.
const crypto = require('crypto');
const { CsatSurvey, Contact } = require('../models');
const { getAllSettings } = require('../controllers/settingsController');

// No existing "public app URL" setting/env var in this codebase (every other
// outbound link — auto-reply, etc — stays in-thread and never needs an
// absolute frontend URL). PUBLIC_APP_URL is new; falls back to localhost so
// this never throws, just produces a non-public link until configured.
function surveyBaseUrl() {
  const configured = process.env.PUBLIC_APP_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  return `http://localhost:${process.env.APP_PORT || 8080}`;
}

// Called right after a ticket's status genuinely transitions INTO a
// closed-behavior status (see ticketsController.js's update handler, same
// spot workflow rules' 'ticket_closed' trigger fires). Returns the created
// (or pre-existing) CsatSurvey row, or null if a survey shouldn't be sent.
async function maybeCreateCsatSurvey(ticket) {
  const settings = await getAllSettings();
  if (settings['csat.enabled'] !== 'true') return null;
  if (!ticket.contactId) return null;

  const contact = await Contact.findByPk(ticket.contactId);
  if (!contact || !contact.email) return null;

  // One survey per ticket — a ticket reopened and re-closed shouldn't spam
  // the contact with a second email.
  const existing = await CsatSurvey.findOne({ where: { ticketId: ticket.id } });
  if (existing) return existing;

  const delayHours = Number(settings['csat.sendDelayHours']) || 0;
  const dueToSendAt = new Date(Date.now() + delayHours * 3600 * 1000);

  return CsatSurvey.create({
    ticketId: ticket.id,
    contactId: ticket.contactId,
    assignedToUserId: ticket.assigneeId || null,
    surveyToken: crypto.randomUUID(),
    status: 'pending',
    dueToSendAt,
  });
}

// The survey email, rendered through the contact_csat_survey template.
// Returns { subject, html, text, attachments, enabled, surveyUrl }.
async function buildSurveyEmail({
  ticket, contact, question, surveyToken,
}) {
  // Lazy: ticketMail requires this module (surveyBaseUrl).
  /* eslint-disable global-require */
  const { ticketContext } = require('./email/ticketMail');
  const { render } = require('./email/templates');
  const { escapeHtml } = require('../utils/richHtml');
  /* eslint-enable global-require */
  const surveyUrl = `${surveyBaseUrl()}/survey/${surveyToken}`;
  // Server-built HTML: the url is ours and escaped.
  const starLinks = [1, 2, 3, 4, 5]
    .map((n) => {
      const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
      return `<a href="${escapeHtml(`${surveyUrl}?rating=${n}`)}" style="display:inline-block;margin:0 6px;padding:8px 14px;background:#fef3c7;border-radius:8px;color:#b45309;text-decoration:none;font-size:20px;letter-spacing:2px;">${stars}</a>`;
    })
    .join('');
  const context = await ticketContext({
    ticket, contact, extra: { survey: { question, starLinks, url: surveyUrl } },
  });
  return { ...(await render('contact_csat_survey', context)), surveyUrl };
}

module.exports = { maybeCreateCsatSurvey, buildSurveyEmail, surveyBaseUrl };
