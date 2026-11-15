// Client-portal emails to a contact: the invite (set your first password),
// the password-reset link and "your portal link". Each company has its own
// portal (CS), so every link is the contact's company's: /portal/<slug>.
const { sendMail } = require('../emailSender');
const { render } = require('../email/templates');
const { surveyBaseUrl } = require('../csatService');

// The address of a company's portal (a slug, or a company with one).
const portalUrl = (company, path = '') => {
  const slug = typeof company === 'string' ? company : company && company.portalSlug;
  return `${surveyBaseUrl()}/portal/${encodeURIComponent(slug || '')}${path}`;
};

const LINKS = {
  invite: { template: 'contact_portal_invite', path: '/welcome' },
  reset: { template: 'contact_portal_reset', path: '/reset' },
  link: { template: 'contact_portal_link', path: null },
};

// Returns the mail sent, or null when an admin has switched the template off.
// Throws on a send failure (SMTP not set up, server refused).
async function sendPortalLink(kind, contact, company, token) {
  const { template, path } = LINKS[kind];
  const home = portalUrl(company);
  const url = path ? `${portalUrl(company, path)}?token=${encodeURIComponent(token)}` : home;
  const out = await render(template, {
    contact: { firstName: contact.firstName || contact.displayName || '', name: contact.displayName || '' },
    portal: { url, home },
  });
  if (!out.enabled) return null;
  const mail = {
    to: [contact.email], subject: out.subject, html: out.html, text: out.text, attachments: out.attachments,
  };
  await sendMail(mail);
  return mail;
}

module.exports = { sendPortalLink, portalUrl };
