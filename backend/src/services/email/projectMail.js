// Sends one templated email about a project (sub-project 6): the project
// beside sendTicketEmail. No ticket threading; the project name and link
// are the placeholders.
const { sendMail } = require('../emailSender');
const { render } = require('./templates');
const { surveyBaseUrl } = require('../csatService');

const projectUrl = (id) => `${surveyBaseUrl()}/projects/${id}`;

// Returns what was sent, or null when the template is off or there is
// nobody to send to. Throws on a send failure.
async function sendProjectEmail(key, { project, to, extra }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return null;
  const out = await render(key, { project: { name: project.name, url: projectUrl(project.id) }, ...extra });
  if (!out.enabled) return null;
  const mail = {
    to: recipients,
    subject: out.subject,
    html: out.html,
    text: out.text,
    attachments: out.attachments,
    headers: { 'X-PRISM-Project-ID': String(project.id) },
  };
  await sendMail(mail);
  return mail;
}

module.exports = { projectUrl, sendProjectEmail };
