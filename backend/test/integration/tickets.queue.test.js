jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeOwnTier, makeTicket, makeTeam, makeContact, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Service desk 5b task 3: team queues and "Take it".
// Security design (user OK 2026-10-15): a team member may see — in the queue
// list and queue count only — and take the UNASSIGNED tickets of their own
// teams, inside their company access, even at the 'own' tier. Opening a
// ticket by id still needs normal access until it is theirs.

let w;
let tina; // System Technician: view_all + edit_own, member of Desk
let olly; // own tier (view_own + edit_own), member of Desk
let dana; // Department Staff (view_department + edit_own), in no team
let desk;
let field;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  olly = await makeOwnTier(w.admin, 'olly', w.deptA.id);
  dana = await makeStaff('dana', w.deptA.id);
  desk = await makeTeam(w.admin, 'Desk', [{ userId: tina.user.id }, { userId: olly.user.id }]);
  field = await makeTeam(w.admin, 'Field', [{ userId: w.admin.user.id }]);
});
afterAll(closeDb);

const ticket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, ...fields,
});
const titles = (body) => body.tickets.map((t) => t.title);
const setDue = (id, at) => models.TicketSla.update({ resolutionDueAt: at }, { where: { ticketId: id } });

describe('queue list', () => {
  it('queue=mine lists only my teams, unassigned first then earliest SLA due', async () => {
    const late = await ticket({ title: 'late', teamId: desk.id });
    const soon = await ticket({ title: 'soon', teamId: desk.id });
    await ticket({ title: 'nodue', teamId: desk.id });
    await ticket({ title: 'mine', teamId: desk.id, assigneeId: tina.user.id });
    await ticket({ title: 'other team', teamId: field.id });
    await ticket({ title: 'no team' });
    await setDue(late.id, new Date('2026-12-02T00:00:00Z'));
    await setDue(soon.id, new Date('2026-12-01T00:00:00Z'));
    const body = expectOk(await tina.agent.get(`${API}/tickets?queue=mine`));
    expect(titles(body)).toEqual(['soon', 'late', 'nodue', 'mine']);
  });

  it('queue view hides closed tickets unless a status is asked for', async () => {
    await ticket({ title: 'open', teamId: desk.id });
    await ticket({ title: 'done', teamId: desk.id, status: 'Closed' });
    expect(titles(expectOk(await tina.agent.get(`${API}/tickets?queue=mine`)))).toEqual(['open']);
    expect(titles(expectOk(await tina.agent.get(`${API}/tickets?queue=mine&status=closed`)))).toEqual(['done']);
  });

  it('queue=<team I am not in> is refused without view_all', async () => {
    expect((await dana.agent.get(`${API}/tickets?queue=${desk.id}`)).status).toBe(400);
    expect((await dana.agent.get(`${API}/tickets?queue=bogus`)).status).toBe(400);
    expectOk(await tina.agent.get(`${API}/tickets?queue=${field.id}`));
  });

  it('own tier sees unassigned tickets of its teams in the queue, but not others or fenced companies', async () => {
    const acme = await makeCompany(w.admin);
    const acmeContact = await makeContact(w.admin, { companyId: acme.id });
    await ticket({ title: 'claimable', teamId: desk.id });
    await ticket({ title: 'taken', teamId: desk.id, assigneeId: tina.user.id });
    await ticket({ title: 'field', teamId: field.id });
    await ticket({ title: 'acme', teamId: desk.id, contactId: acmeContact.id, departmentId: null });
    const [{ id: internalId }] = await models.sequelize.query('SELECT id FROM Companies WHERE isInternal = 1', { type: 'SELECT' });
    await setCompanyAccess(w.admin, olly.user.id, { allCompanies: false, companyIds: [internalId] });
    expect(titles(expectOk(await olly.agent.get(`${API}/tickets?queue=mine`)))).toEqual(['claimable']);
    // The widening is for queues only: the plain list and the detail page keep the own tier.
    expect(titles(expectOk(await olly.agent.get(`${API}/tickets`)))).toEqual([]);
  });

  it('queue-count counts unassigned not-closed tickets in my teams within scope', async () => {
    await ticket({ teamId: desk.id });
    await ticket({ teamId: desk.id });
    await ticket({ teamId: desk.id, assigneeId: tina.user.id });
    await ticket({ teamId: desk.id, status: 'Closed' });
    await ticket({ teamId: field.id });
    expect(expectOk(await olly.agent.get(`${API}/tickets/queue-count`))).toEqual({ count: 2 });
    expect(expectOk(await dana.agent.get(`${API}/tickets/queue-count`))).toEqual({ count: 0 });
  });
});

describe('POST /tickets/:id/take', () => {
  it('take: edit_own team member claims an unassigned team ticket', async () => {
    const t = await ticket({ teamId: desk.id });
    const body = expectOk(await olly.agent.post(`${API}/tickets/${t.id}/take`));
    expect(body.ticket.assigneeId).toBe(olly.user.id);
    // Now theirs, so the normal own-tier rules let them open it.
    expectOk(await olly.agent.get(`${API}/tickets/${t.id}`));
  });

  it('take: 409 names the winner when already assigned', async () => {
    const t = await ticket({ teamId: desk.id, assigneeId: tina.user.id });
    const res = await tina.agent.post(`${API}/tickets/${t.id}/take`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Already taken by Test tina');
  });

  it('take: two concurrent takes, exactly one wins, assignment clock stops once', async () => {
    const t = await ticket({ teamId: desk.id });
    const [a, b] = await Promise.all([
      tina.agent.post(`${API}/tickets/${t.id}/take`),
      olly.agent.post(`${API}/tickets/${t.id}/take`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? tina : olly;
    const fresh = await models.Ticket.findByPk(t.id);
    expect(fresh.assigneeId).toBe(winner.user.id);
    const sla = await models.TicketSla.findOne({ where: { ticketId: t.id } });
    expect(sla.assignRunningSince).toBeNull();
    expect(sla.assignMetAt).not.toBeNull();
    const rows = await models.TicketActivity.findAll({ where: { ticketId: t.id, action: 'assigneeId' } });
    expect(rows).toHaveLength(1);
  });

  it('take: view-only non-member is refused; out of scope looks like missing', async () => {
    const t = await ticket({ teamId: field.id });
    // Dana can view it (department) but can't edit it and isn't in Field.
    expect((await dana.agent.post(`${API}/tickets/${t.id}/take`)).status).toBe(403);
    // Olly can't see it at all: same answer as a ticket that doesn't exist.
    const hidden = await olly.agent.post(`${API}/tickets/${t.id}/take`);
    const missing = await olly.agent.post(`${API}/tickets/999999/take`);
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it('take: member fenced out of the ticket company is refused', async () => {
    const acme = await makeCompany(w.admin);
    const acmeContact = await makeContact(w.admin, { companyId: acme.id });
    const t = await ticket({ teamId: desk.id, contactId: acmeContact.id, departmentId: null });
    const [{ id: internalId }] = await models.sequelize.query('SELECT id FROM Companies WHERE isInternal = 1', { type: 'SELECT' });
    await setCompanyAccess(w.admin, tina.user.id, { allCompanies: false, companyIds: [internalId] });
    expect((await tina.agent.post(`${API}/tickets/${t.id}/take`)).status).toBe(404);
    expect((await models.Ticket.findByPk(t.id)).assigneeId).toBeNull();
  });

  it('take: logs assignee activity and fires ticket_assigned rules', async () => {
    const rule = await models.WorkflowRule.create({ name: 'On assign', triggerEvent: 'ticket_assigned', isActive: true });
    await models.WorkflowAction.create({ ruleId: rule.id, actionType: 'set_priority', actionValue: { priority: 'high' } });
    const t = await ticket({ teamId: desk.id });
    expectOk(await tina.agent.post(`${API}/tickets/${t.id}/take`));
    expect((await models.Ticket.findByPk(t.id)).priority).toBe('high');
    const activity = expectOk(await tina.agent.get(`${API}/tickets/${t.id}/activity`)).activity;
    expect(activity.map((a) => a.action)).toContain('assigneeId');
  });
});

describe('ticket page access', () => {
  it('access.canTake true for a viewing team member on an unassigned ticket, false once assigned', async () => {
    const t = await ticket({ teamId: desk.id });
    expect(expectOk(await tina.agent.get(`${API}/tickets/${t.id}`)).ticket.access.canTake).toBe(true);
    // Dana can view it (department) but isn't in Desk and can't edit it.
    expect(expectOk(await dana.agent.get(`${API}/tickets/${t.id}`)).ticket.access.canTake).toBe(false);
    expectOk(await tina.agent.post(`${API}/tickets/${t.id}/take`));
    expect(expectOk(await tina.agent.get(`${API}/tickets/${t.id}`)).ticket.access.canTake).toBe(false);
  });
});
