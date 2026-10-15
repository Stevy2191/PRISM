// Outbound email is recorded, not sent (see tickets.comments.test.js).
jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, setSettings, waitFor,
} = require('./fixtures');
const { sendAutoReply } = require('../../src/services/inboundEmailService');
const { runChecks } = require('../../src/services/csatScheduler');

// The emails PRISM already sent (tech reply, auto-reply, CSAT survey) go
// through the templates; technicians get an email signature; the new
// "resolved" email is off until an admin turns it on.

let w;
let tech;
let ticket;
const settle = () => new Promise((r) => { setTimeout(r, 200); });
const commentsUrl = () => `${API}/tickets/${ticket.id}/comments`;
const prefs = (agent, id, body) => agent.patch(`${API}/users/${id}/preferences`).send(body);
const putTemplate = (key, body) => w.admin.agent.put(`${API}/settings/email-templates/${key}`).send(body);

beforeEach(async () => {
  await resetData();
  sendMail.mockReset();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id,
  });
});
afterAll(closeDb);

it('the tech signature is included; a signature with script is stored stripped', async () => {
  const res = expectOk(await prefs(tech.agent, tech.user.id, {
    emailSignature: '<p><strong>Tina</strong> | Service desk<script>alert(1)</script><img src="x" onerror="alert(1)"></p>',
  }));
  expect(res.user.emailSignature).toBe('<p><strong>Tina</strong> | Service desk<img src="x" /></p>');
  expect((await models.User.findByPk(tech.user.id)).emailSignature).toBe(res.user.emailSignature);

  expectOk(await tech.agent.post(commentsUrl()).send({ body: 'Fixed it' }), 201);
  await waitFor(() => sendMail.mock.calls.length === 1);
  const mail = sendMail.mock.calls[0][0];
  expect(mail.html).toContain('<strong>Tina</strong> | Service desk');
  expect(mail.html).not.toMatch(/script|onerror/);
  expect(mail.text).toContain('Tina | Service desk');
});

it('a signature is limited in size and set only by its owner or an admin', async () => {
  expect((await prefs(tech.agent, tech.user.id, { emailSignature: `<p>${'x'.repeat(20001)}</p>` })).status).toBe(400);
  expect((await prefs(tech.agent, tech.user.id, { emailSignature: 42 })).status).toBe(400);
  const other = await makeTech('otto', w.deptA.id);
  expect((await prefs(other.agent, tech.user.id, { emailSignature: '<p>hi</p>' })).status).toBe(403);
  expectOk(await prefs(w.admin.agent, tech.user.id, { emailSignature: '<p>Set by admin</p>' }));
  expectOk(await prefs(tech.agent, tech.user.id, { emailSignature: '' }));
  expect((await models.User.findByPk(tech.user.id)).emailSignature).toBeNull();
});

it('a disabled contact_tech_reply sends nothing', async () => {
  expectOk(await putTemplate('contact_tech_reply', { subject: 'Re: [Ticket #{{ticket.number}}]', bodyHtml: '<p>{{comment.body}}</p>', enabled: false }));
  expectOk(await tech.agent.post(commentsUrl()).send({ body: 'quiet' }), 201);
  await settle();
  expect(sendMail).not.toHaveBeenCalled();
});

it('auto-reply and csat survey use their templates', async () => {
  expectOk(await putTemplate('contact_auto_reply', {
    subject: 'Got it, {{contact.firstName}} [Ticket #{{ticket.number}}]', bodyHtml: '<p>Thanks {{contact.firstName}}</p>',
  }));
  const contact = await models.Contact.findByPk(w.contact.id);
  await sendAutoReply(await models.Ticket.findByPk(ticket.id), contact);
  const auto = sendMail.mock.calls[0][0];
  expect(auto).toEqual(expect.objectContaining({
    to: [contact.email], subject: 'Got it, Casey [Ticket #00001]', headers: { 'X-PRISM-Ticket-ID': '00001' },
  }));
  expect(auto.html).toContain('<p>Thanks Casey</p>');

  sendMail.mockReset();
  await setSettings(w.admin, { 'csat.enabled': 'true', 'csat.sendDelayHours': '0', 'csat.surveyQuestion': 'Happy <yes>?' });
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Closed' }));
  const survey = await models.CsatSurvey.findOne({ where: { ticketId: ticket.id } });
  await runChecks();
  const mail = sendMail.mock.calls.find(([m]) => /How did we do\?/.test(m.subject))[0];
  expect(mail.subject).toBe('How did we do? [Ticket #00001] Printer offline');
  expect(mail.html).toContain(`/survey/${survey.surveyToken}?rating=5`);
  expect(mail.html).toContain('Happy &lt;yes&gt;?');
  expect(mail.text).toContain(`/survey/${survey.surveyToken}`);
  expect((await survey.reload()).sentAt).not.toBeNull();
});

it('contact_resolved is off by default and sends once enabled', async () => {
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Closed' }));
  await settle();
  expect(sendMail.mock.calls.filter(([m]) => /resolved/.test(m.subject))).toEqual([]);

  expectOk(await putTemplate('contact_resolved', {
    subject: 'Your request is resolved [Ticket #{{ticket.number}}] {{ticket.title}}', bodyHtml: '<p>Done: {{ticket.status}}</p>', enabled: true,
  }));
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Open' }));
  await settle();
  expect(sendMail).not.toHaveBeenCalled();
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Closed' }));
  await waitFor(() => sendMail.mock.calls.length === 1);
  const mail = sendMail.mock.calls[0][0];
  expect(mail).toEqual(expect.objectContaining({ to: [w.contact.email], subject: 'Your request is resolved [Ticket #00001] Printer offline' }));
  expect(mail.html).toContain('Done: Closed');
});
