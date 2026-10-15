// Mail is recorded, not sent; the real "is SMTP set up?" check stays.
jest.mock('../../src/services/emailSender', () => ({
  ...jest.requireActual('../../src/services/emailSender'),
  sendMail: jest.fn(async () => ({})),
}));
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeTeam, makeCompany, makeContact, setCompanyAccess, setSettings, waitFor,
} = require('./fixtures');
const { createNotification } = require('../../src/services/notifications');
const { effectiveEmailPref } = require('../../src/services/email/notificationMail');

// Technicians get an email for some in-app notifications: their own on/off
// per event, else the admin default; the system-wide switch still wins.

let w;
let tina;
let otto;
const settle = () => new Promise((r) => { setTimeout(r, 250); });
const mailsTo = (addr) => sendMail.mock.calls.map(([m]) => m).filter((m) => m.to.includes(addr));
const prefs = (who, body) => who.agent.patch(`${API}/users/${who.user.id}/preferences`).send(body);
const withEmail = async (u, email) => { await models.User.update({ email }, { where: { id: u.user.id } }); return u; };

beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  tina = await withEmail(await makeTech('tina', w.deptA.id), 'tina@acme.com');
  otto = await withEmail(await makeTech('otto', w.deptA.id), 'otto@acme.com');
  await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
  await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
});
afterAll(closeDb);

const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id, ...fields,
});

it('assignment emails the assignee when their pref is on, not when off', async () => {
  await newTicket({ assigneeId: tina.user.id });
  await waitFor(() => mailsTo('tina@acme.com').length === 1);
  const [mail] = mailsTo('tina@acme.com');
  expect(mail.subject).toBe('[Ticket #00001] Assigned to you: Printer offline');
  expect(mail.to).toEqual(['tina@acme.com']);
  expect(mail.html).toContain('Ticket assigned to you: Printer offline');

  expectOk(await prefs(tina, { notificationEmailPrefs: { assigned: false } }));
  sendMail.mockClear();
  await newTicket({ assigneeId: tina.user.id });
  await settle();
  expect(mailsTo('tina@acme.com')).toEqual([]);
  // The in-app notification still arrives.
  expect(await models.Notification.count({ where: { userId: tina.user.id, type: 'assigned' } })).toBe(2);
});

it('the admin default applies when the user has no pref', async () => {
  await setSettings(w.admin, { 'notifications.emailDefaults': { assigned: false } });
  await newTicket({ assigneeId: tina.user.id });
  await settle();
  expect(mailsTo('tina@acme.com')).toEqual([]);
  // A user's own choice beats the default.
  expectOk(await prefs(otto, { notificationEmailPrefs: { assigned: true } }));
  await newTicket({ assigneeId: otto.user.id });
  await waitFor(() => mailsTo('otto@acme.com').length === 1);

  const user = { notificationEmailPrefs: { comment: false } };
  expect(effectiveEmailPref(user, 'comment', {})).toBe(false);
  expect(effectiveEmailPref(user, 'watcher_update', {})).toBe(false);
  expect(effectiveEmailPref(user, 'sla_breached', {})).toBe(true);
  expect(effectiveEmailPref(user, 'watcher_update', { watcher_update: true })).toBe(true);
  expect(effectiveEmailPref({}, 'overdue', { overdue: true })).toBe(false);
});

it('a type turned off system-wide sends neither in-app nor email', async () => {
  await setSettings(w.admin, { 'notifications.enabledTypes': ['comment'] });
  await newTicket({ assigneeId: tina.user.id });
  await settle();
  expect(mailsTo('tina@acme.com')).toEqual([]);
  expect(await models.Notification.count({ where: { userId: tina.user.id } })).toBe(0);
});

it('new ticket into a team while unassigned notifies members except the actor', async () => {
  const desk = await makeTeam(w.admin, 'Desk', [{ userId: tina.user.id }, { userId: otto.user.id }]);
  const t = await newTicket({ teamId: desk.id });
  // The actor is otto here: he isn't told about his own ticket.
  const fromOtto = await makeTicket(otto.agent, {
    title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id, teamId: desk.id,
  });
  await waitFor(() => mailsTo('tina@acme.com').length === 2);
  await settle();
  const queue = await models.Notification.findAll({ where: { type: 'new_in_queue' }, order: [['id', 'ASC']] });
  expect(queue.map((n) => [n.userId, n.ticketId])).toEqual([
    [tina.user.id, t.id], [otto.user.id, t.id], [tina.user.id, fromOtto.id],
  ]);
  expect(mailsTo('tina@acme.com')[0].subject).toBe(`[Ticket #${String(t.id).padStart(5, '0')}] New in your queue: Printer offline`);

  // Moved into another team while unassigned: that team hears about it.
  const field = await makeTeam(w.admin, 'Field', [{ userId: otto.user.id }]);
  await models.Notification.destroy({ where: {} });
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ teamId: field.id }));
  expect((await models.Notification.findAll({ where: { type: 'new_in_queue' } })).map((n) => n.userId)).toEqual([otto.user.id]);
  // An assigned ticket changing team is not "in the queue".
  const assigned = await newTicket({ assigneeId: tina.user.id });
  await models.Notification.destroy({ where: {} });
  expectOk(await w.admin.agent.patch(`${API}/tickets/${assigned.id}`).send({ teamId: desk.id }));
  expect(await models.Notification.count({ where: { type: 'new_in_queue' } })).toBe(0);
});

it('a user who cannot reach the ticket\'s company gets no email', async () => {
  const acme = await makeCompany(w.admin);
  const client = await makeContact(w.admin, { companyId: acme.id });
  const internalId = (await models.Company.findOne({ where: { isInternal: true } })).id;
  await setCompanyAccess(w.admin, otto.user.id, { allCompanies: false, companyIds: [internalId] });
  const desk = await makeTeam(w.admin, 'Desk', [{ userId: tina.user.id }, { userId: otto.user.id }]);
  await makeTicket(w.admin.agent, { title: 'Acme issue', contactId: client.id, teamId: desk.id });
  await waitFor(() => mailsTo('tina@acme.com').length === 1);
  await settle();
  expect(mailsTo('otto@acme.com')).toEqual([]);
});

it('an inactive user gets no email', async () => {
  const t = await newTicket();
  await models.User.update({ isActive: false }, { where: { id: tina.user.id } });
  await createNotification({ userId: tina.user.id, type: 'assigned', message: 'Ticket assigned to you: x', ticketId: t.id });
  await settle();
  expect(mailsTo('tina@acme.com')).toEqual([]);
});

it('no email when SMTP is not set up, and the action still succeeds', async () => {
  await models.SystemSettings.destroy({ where: { key: 'smtp.host' } });
  await newTicket({ assigneeId: tina.user.id });
  await settle();
  expect(sendMail).not.toHaveBeenCalled();
});

it('bad notificationEmailPrefs is a 400', async () => {
  for (const bad of [{ assigned: 'yes' }, { bogus: true }, ['assigned'], 'x', { reply: true }]) {
    // eslint-disable-next-line no-await-in-loop
    expect((await prefs(tina, { notificationEmailPrefs: bad })).status).toBe(400);
  }
  expectOk(await prefs(tina, { notificationEmailPrefs: { comment: false, sla_breached: true } }));
  expect((await models.User.findByPk(tina.user.id)).notificationEmailPrefs).toEqual({ comment: false, sla_breached: true });
  expectOk(await prefs(tina, { notificationEmailPrefs: null }));
  expect((await models.User.findByPk(tina.user.id)).notificationEmailPrefs).toBeNull();
  // And the admin default is checked the same way.
  expect((await w.admin.agent.patch(`${API}/settings`).send({ 'notifications.emailDefaults': { assigned: 'no' } })).status).toBe(400);
});

it('SLA warning emails through staff_sla_warning', async () => {
  const t = await newTicket({ assigneeId: otto.user.id });
  await waitFor(() => mailsTo('otto@acme.com').length === 1);
  sendMail.mockClear();
  await createNotification({ userId: tina.user.id, type: 'sla_warning', message: 'Resolution SLA at risk: Printer offline', ticketId: t.id });
  await waitFor(() => mailsTo('tina@acme.com').length === 1);
  const [mail] = mailsTo('tina@acme.com');
  expect(mail.subject).toBe('[Ticket #00001] SLA warning: Printer offline');
  expect(mail.html).toContain('Resolution SLA at risk: Printer offline');
});
