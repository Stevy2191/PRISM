// The default email templates (spec 5a): one entry per key with its
// audience, subject, HTML body and the placeholders it may use. Admins can
// override subject, body and enabled (EmailTemplates rows); everything else
// here is fixed. A placeholder is HTML-escaped unless it says `html: true`;
// only server-built or sanitized values may say so.

const TICKET = [
  { name: 'ticket.number', description: 'Ticket number, e.g. 00042' },
  { name: 'ticket.title', description: 'Ticket title' },
  { name: 'ticket.url', description: 'Link to the ticket' },
  { name: 'ticket.status', description: 'Current status' },
  { name: 'ticket.priority', description: 'Priority' },
  { name: 'contact.firstName', description: "Contact's first name" },
  { name: 'contact.name', description: "Contact's full name" },
  { name: 'tech.name', description: 'Name of the technician' },
  { name: 'org.name', description: 'Your organization name' },
  { name: 'comment.body', description: 'Text of the reply or comment' },
];
const SIGNATURE = { name: 'signature', description: "The technician's email signature", html: true };
const NOTIFICATION = { name: 'notification.message', description: 'What happened' };
const SURVEY = [
  { name: 'survey.question', description: 'The survey question' },
  { name: 'survey.starLinks', description: 'The 1–5 star rating buttons', html: true },
  { name: 'survey.url', description: 'Link to the survey page' },
];

const PORTAL = [
  { name: 'contact.firstName', description: "Contact's first name" },
  { name: 'contact.name', description: "Contact's full name" },
  { name: 'org.name', description: 'Your organization name' },
  { name: 'portal.url', description: 'The one-time link (works once, for 72 hours)' },
  { name: 'portal.home', description: 'The portal address' },
];

const staff = (name, subject, intro) => ({
  audience: 'staff',
  name,
  subject,
  bodyHtml: `<p>${intro}</p><p><strong>{{ticket.title}}</strong><br>Priority: {{ticket.priority}} · Status: {{ticket.status}}</p>`
    + '<p><a href="{{ticket.url}}">Open ticket #{{ticket.number}}</a></p>',
  placeholders: [...TICKET, NOTIFICATION],
  defaultEnabled: true,
});

const PROJECT = [
  { name: 'project.name', description: 'Project name' },
  { name: 'project.url', description: 'Link to the project' },
  { name: 'org.name', description: 'Your organization name' },
];

// Project notifications (sub-project 6): the message says what happened.
const staffProject = (name, subject, intro) => ({
  audience: 'staff',
  name,
  subject,
  bodyHtml: `<p>${intro}</p><p><strong>{{project.name}}</strong></p><p><a href="{{project.url}}">Open project</a></p>`,
  placeholders: [...PROJECT, NOTIFICATION],
  defaultEnabled: true,
});

const CATALOG = Object.freeze({
  contact_auto_reply: {
    audience: 'contact',
    name: 'Request received (auto-reply)',
    subject: 'Your request has been received [Ticket #{{ticket.number}}]',
    bodyHtml: '<p>Hi {{contact.firstName}},</p><p>We have received your request and created ticket #{{ticket.number}}. '
      + 'Our team will be in touch shortly.</p><p>— {{org.name}}</p>',
    placeholders: TICKET,
    defaultEnabled: true,
  },
  contact_tech_reply: {
    audience: 'contact',
    name: 'Reply from a technician',
    subject: 'Re: [Ticket #{{ticket.number}}] {{ticket.title}}',
    bodyHtml: '<p>{{comment.body}}</p><p>{{signature}}</p>'
      + '<p style="color:#64748b">Reply to this email to respond to your ticket.</p>',
    placeholders: [...TICKET, SIGNATURE],
    defaultEnabled: true,
  },
  // A new email to customers, so it starts switched off.
  contact_resolved: {
    audience: 'contact',
    name: 'Ticket resolved',
    subject: 'Your request is resolved [Ticket #{{ticket.number}}] {{ticket.title}}',
    bodyHtml: '<p>Hi {{contact.firstName}},</p><p>Your request "{{ticket.title}}" has been marked {{ticket.status}}.</p>'
      + '<p>If anything is still wrong, just reply to this email.</p><p>— {{org.name}}</p>',
    placeholders: TICKET,
    defaultEnabled: false,
  },
  contact_csat_survey: {
    audience: 'contact',
    name: 'Satisfaction survey',
    subject: 'How did we do? [Ticket #{{ticket.number}}] {{ticket.title}}',
    bodyHtml: '<p>Hi {{contact.firstName}},</p><p>Your recent support request has been resolved. We\'d love to hear how we did.</p>'
      + '<p><strong>{{survey.question}}</strong></p><p style="text-align:center">{{survey.starLinks}}</p>'
      + '<p style="text-align:center"><a href="{{survey.url}}">Or click here to leave detailed feedback</a></p>',
    placeholders: [...TICKET, ...SURVEY],
    defaultEnabled: true,
  },
  // Client portal (7a). Sent only when staff press "Send portal invite" or
  // the contact asks for a reset, so both start on.
  contact_portal_invite: {
    audience: 'contact',
    name: 'Portal invite',
    subject: 'Your {{org.name}} support portal account',
    bodyHtml: '<p>Hi {{contact.firstName}},</p><p>You can now use the {{org.name}} support portal to raise requests and follow them.</p>'
      + '<p><a href="{{portal.url}}">Set your password</a></p>'
      + '<p style="color:#64748b">This link works once and expires in 72 hours. After that, sign in at {{portal.home}}.</p>',
    placeholders: PORTAL,
    defaultEnabled: true,
  },
  contact_portal_reset: {
    audience: 'contact',
    name: 'Portal password reset',
    subject: 'Reset your {{org.name}} support portal password',
    bodyHtml: '<p>Hi {{contact.firstName}},</p><p>Someone asked to reset your support portal password. If that was you, choose a new one here:</p>'
      + '<p><a href="{{portal.url}}">Reset your password</a></p>'
      + '<p style="color:#64748b">This link works once and expires in 72 hours. If you didn\'t ask, ignore this email; your password stays the same.</p>',
    placeholders: PORTAL,
    defaultEnabled: true,
  },
  staff_assigned: staff('Ticket assigned to you', '[Ticket #{{ticket.number}}] Assigned to you: {{ticket.title}}', '{{notification.message}}'),
  staff_reply: staff('New reply or comment', '[Ticket #{{ticket.number}}] New comment: {{ticket.title}}', '{{notification.message}}'),
  staff_watcher_update: staff('Update on a watched ticket', '[Ticket #{{ticket.number}}] Update: {{ticket.title}}', '{{notification.message}}'),
  staff_new_in_queue: staff('New ticket in your queue', '[Ticket #{{ticket.number}}] New in your queue: {{ticket.title}}', '{{notification.message}}'),
  staff_sla_warning: staff('SLA warning', '[Ticket #{{ticket.number}}] SLA warning: {{ticket.title}}', '{{notification.message}}'),
  staff_sla_breached: staff('SLA breached', '[Ticket #{{ticket.number}}] SLA breached: {{ticket.title}}', '{{notification.message}}'),
  staff_task_added: staffProject('Added to a project task', '[{{project.name}}] You were added to a task', '{{notification.message}}'),
  staff_task_unblocked: staffProject('Project task ready to start', '[{{project.name}}] A task you are on is ready to start', '{{notification.message}}'),
  staff_budget_warning: staffProject('Project budget warning', '[{{project.name}}] Budget warning', '{{notification.message}}'),
  staff_budget_reached: staffProject('Project budget reached', '[{{project.name}}] Budget reached', '{{notification.message}}'),
});

Object.values(CATALOG).forEach((t) => Object.freeze(t));

module.exports = { CATALOG };
