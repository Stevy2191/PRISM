jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const { createTicket, updateTicket } = require('../../src/services/tickets/ticketWrite');
const {
  API, expectOk, makeWorld, makeTech, makeTicket,
} = require('./fixtures');

// Service desk 5b task 2: ticket create/update moved into
// services/tickets/ticketWrite.js so bulk, take-it, merge and recurring use
// the very same checks and side effects as a single edit.

let w;
let tech;
beforeEach(async () => {
  await resetData();
  sendMail.mockReset();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

const base = () => ({ title: 'Printer offline', contactId: w.contact.id });

it('create accepts source email; portal and recurring become manual', async () => {
  const sources = [];
  for (const source of ['email', 'portal', 'recurring']) {
    // eslint-disable-next-line no-await-in-loop
    sources.push((await makeTicket(tech.agent, { ...base(), source })).source);
  }
  expect(sources).toEqual(['email', 'manual', 'manual']);
});

it('create and update refuse an unknown teamId with 400', async () => {
  const res = await tech.agent.post(`${API}/tickets`).send({ ...base(), teamId: 99999 });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('Team not found');
  const t = await makeTicket(tech.agent, base());
  const patch = await tech.agent.patch(`${API}/tickets/${t.id}`).send({ teamId: 99999 });
  expect(patch.status).toBe(400);
  expect(patch.body.message).toBe('Team not found');
});

it('createTicket with createdById records the given creator and checks the actor', async () => {
  const ticket = await createTicket(tech.user, base(), {
    req: { user: tech.user }, createdById: w.admin.user.id, source: 'recurring',
  });
  expect(ticket.createdBy).toBe(w.admin.user.id);
  expect(ticket.source).toBe('recurring');
  // The actor must still be able to see the contact.
  await expect(createTicket(tech.user, { ...base(), contactId: 999999 }, { req: { user: tech.user } }))
    .rejects.toMatchObject({ status: 400 });
});

it('updateTicket quiet close skips CSAT, resolved email and ticket_closed rules', async () => {
  expectOk(await w.admin.agent.put(`${API}/settings/email-templates/contact_resolved`).send({
    subject: 'Resolved', bodyHtml: '<p>Done</p>', enabled: true,
  }));
  const rule = await models.WorkflowRule.create({ name: 'On close', triggerEvent: 'ticket_closed', isActive: true });
  await models.WorkflowAction.create({ ruleId: rule.id, actionType: 'set_priority', actionValue: { priority: 'critical' } });
  const t = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptA.id });
  sendMail.mockReset();
  const ticket = await models.Ticket.findByPk(t.id);
  await updateTicket({ user: w.admin.user }, ticket, { status: 'Closed' }, { quiet: true });
  await new Promise((r) => { setTimeout(r, 200); });
  const after = await models.Ticket.findByPk(t.id);
  expect(after.status).toBe('Closed');
  expect(after.priority).toBe('medium');
  expect(sendMail).not.toHaveBeenCalled();
  expect(await models.CsatSurvey.count({ where: { ticketId: t.id } })).toBe(0);
});
