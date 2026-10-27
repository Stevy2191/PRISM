// Client-portal emails to a contact: the invite (set your first password)
// and the password-reset link. Both go through the admin-editable templates.
const { sendMail } = require('../emailSender');
const { render } = require('../email/templates');
const { surveyBaseUrl } = require('../csatService');

const portalUrl = (path = '') => `${surveyBaseUrl()}/portal${path}`;

const LINKS = {
  invite: { template: 'contact_portal_invite', path: '/welcome' },
  reset: { template: 'contact_portal_reset', path: '/reset' },
};

// Returns the mail sent, or null when an admin has switched the template off.
// Throws on a send failure (SMTP not set up, server refused).
async function sendPortalLink(kind, contact, token) {
  const { template, path } = LINKS[kind];
  const url = `${portalUrl(path)}?token=${encodeURIComponent(token)}`;
  const out = await render(template, {
    contact: { firstName: contact.firstName || contact.displayName || '', name: contact.displayName || '' },
    portal: { url, home: portalUrl() },
  });
  if (!out.enabled) return null;
  const mail = {
    to: [contact.email], subject: out.subject, html: out.html, text: out.text, attachments: out.attachments,
  };
  await sendMail(mail);
  return mail;
}

module.exports = { sendPortalLink, portalUrl };
