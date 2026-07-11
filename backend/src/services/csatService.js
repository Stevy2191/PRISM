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

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared by the scheduler (real send) and the settings-page preview button —
// takes plain values rather than model instances so the preview endpoint can
// call it with fabricated sample data without touching the database.
function buildSurveyEmail({ contactFirstName, ticketId, ticketTitle, question, surveyToken, expiryDays, companyName }) {
  const base = surveyBaseUrl();
  const surveyUrl = `${base}/survey/${surveyToken}`;
  const ticketNumber = String(ticketId).padStart(5, '0');
  const subject = `How did we do? — Ticket #${ticketNumber} ${ticketTitle}`;
  const firstName = contactFirstName || 'there';

  const starLinks = [1, 2, 3, 4, 5]
    .map((n) => {
      const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
      return `<a href="${surveyUrl}?rating=${n}" style="display:inline-block;margin:0 6px;padding:8px 14px;background:#fef3c7;border-radius:8px;color:#b45309;text-decoration:none;font-size:20px;letter-spacing:2px;">${stars}</a>`;
    })
    .join('');

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Your recent support request has been resolved. We'd love to hear how we did.</p>
  <p style="font-weight:600;font-size:16px;margin-top:24px;">${escapeHtml(question)}</p>
  <div style="text-align:center;margin:20px 0;">${starLinks}</div>
  <p style="text-align:center;">
    <a href="${surveyUrl}" style="color:#2563eb;">Or click here to leave detailed feedback</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 12px;" />
  <p style="font-size:12px;color:#64748b;">
    ${escapeHtml(companyName)}<br/>
    This survey expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}.
  </p>
</div>`.trim();

  const text = [
    `Hi ${firstName},`,
    '',
    "Your recent support request has been resolved. We'd love to hear how we did.",
    '',
    question,
    '',
    'Rate your experience (1-5 stars):',
    ...[1, 2, 3, 4, 5].map((n) => `  ${n} star${n === 1 ? '' : 's'}: ${surveyUrl}?rating=${n}`),
    '',
    `Or leave detailed feedback: ${surveyUrl}`,
    '',
    `${companyName}`,
    `This survey expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}.`,
  ].join('\n');

  return { subject, html, text, surveyUrl };
}

module.exports = { maybeCreateCsatSurvey, buildSurveyEmail, surveyBaseUrl };
