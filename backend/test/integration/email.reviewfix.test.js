jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, waitFor,
} = require('./fixtures');

// Final review fixes for plan 5a (2026-10-15).

let w;
let tech;
beforeEach(async () => {
  await resetData();
  sendMail.mockReset();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

it('only people who can edit users change an email address', async () => {
  // It decides who counts as staff on inbound mail.
  const url = `${API}/users/${tech.user.id}`;
  const res = await tech.agent.patch(url).send({ email: 'ann@customer.example' });
  expect(res.status).toBe(403);
  expect((await models.User.findByPk(tech.user.id)).email).toBeNull();
  // Saving the profile with the address unchanged is fine.
  expectOk(await tech.agent.patch(url).send({ email: null, jobTitle: 'Tech' }));
  expectOk(await w.admin.agent.patch(url).send({ email: 'tina@acme.com' }));
  expectOk(await tech.agent.patch(url).send({ email: 'TINA@acme.com ', jobTitle: 'Senior tech' }));
  expect((await models.User.findByPk(tech.user.id)).email).toBe('tina@acme.com');
});

it('preference changes are audited', async () => {
  expectOk(await tech.agent.patch(`${API}/users/${tech.user.id}/preferences`).send({ emailSignature: '<p>T</p>', notificationEmailPrefs: { assigned: false } }));
  const audit = await models.AuditLog.findOne({ where: { action: 'user.preferences_update', entityId: tech.user.id } });
  expect(audit.userId).toBe(tech.user.id);
  expect(audit.meta.fields.sort()).toEqual(['emailSignature', 'notificationEmailPrefs']);
});

it('the automatic statuses keep their kind', async () => {
  // Status rows outlive resetData: start from, and leave, the seeded state.
  const responded = await models.TicketStatus.findOne({ where: { systemKey: 'user_responded' } });
  await responded.update({ behaviorType: 'open', color: '#ec4899' });
  try {
    const res = await w.admin.agent.patch(`${API}/ticket-statuses/${responded.id}`).send({ behaviorType: 'closed' });
    expect(res.status).toBe(400);
    // Recolouring is still fine.
    expectOk(await w.admin.agent.patch(`${API}/ticket-statuses/${responded.id}`).send({ color: '#ff00ff' }));
    expect((await responded.reload()).behaviorType).toBe('open');
  } finally {
    await responded.update({ behaviorType: 'open', color: '#ec4899' });
  }
});

it('a workflow rule closing a ticket sends the resolved email when it is on', async () => {
  expectOk(await w.admin.agent.put(`${API}/settings/email-templates/contact_resolved`).send({
    subject: 'Resolved [Ticket #{{ticket.number}}]', bodyHtml: '<p>Done</p>', enabled: true,
  }));
  const rule = await models.WorkflowRule.create({ name: 'Auto close', triggerEvent: 'ticket_priority_changed', isActive: true });
  await models.WorkflowAction.create({ ruleId: rule.id, actionType: 'set_status', actionValue: { status: 'Closed' } });
  const t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'low' }));
  await waitFor(() => sendMail.mock.calls.length === 1);
  expect((await models.Ticket.findByPk(t.id)).status).toBe('Closed');
  expect(sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({ to: [w.contact.email], subject: 'Resolved [Ticket #00001]' }));
});
