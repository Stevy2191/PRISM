const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, makeContact, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// SLA clocks (sub-project 4) on real ticket events. The Standard policy has
// no schedule, so minutes are wall-clock minutes. Standard medium targets:
// response 480, resolution 1440; tests add an assign target where needed.

const {
  SlaPolicy, TicketSla, Comment, TicketStatus, WorkflowRule, WorkflowAction,
} = models;
const T0 = '2026-03-09T15:00:00.000Z';
const at = (min) => new Date(new Date(T0).getTime() + min * 60000).toISOString();
const iso = (d) => (d ? new Date(d).toISOString() : d);
const MIN = 60000;

let w;
let tech;
let std;
const sla = (ticketId) => TicketSla.findOne({ where: { ticketId } });
const patchTicket = async (id, body) => expectOk(await w.admin.agent.patch(`${API}/tickets/${id}`).send(body));
const setStandard = async (targets) => expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({ targets }));
const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', ...fields,
});

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  std = await SlaPolicy.findOne({ where: { isDefault: true } });
  await setStandard([{ priority: 'medium', assignMinutes: 30 }]);
  freezeClock(T0);
});
afterEach(unfreezeClock);
afterAll(async () => {
  await TicketStatus.destroy({ where: { name: 'Waiting on customer' } });
  await closeDb();
});

describe('starting clocks', () => {
  it('a new unassigned ticket starts all three clocks on the Standard policy', async () => {
    const t = await newTicket();
    const s = await sla(t.id);
    expect([s.slaPolicyId, s.priority]).toEqual([std.id, 'medium']);
    expect([iso(s.assignRunningSince), iso(s.assignDueAt), iso(s.responseDueAt), iso(s.resolutionDueAt)])
      .toEqual([T0, at(30), at(480), at(1440)]);
  });

  it('a ticket assigned at creation does not start the assign clock', async () => {
    const s = await sla((await newTicket({ assigneeId: tech.user.id })).id);
    expect([s.assignTargetMinutes, s.assignRunningSince, s.assignDueAt]).toEqual([30, null, null]);
    expect(iso(s.responseRunningSince)).toBe(T0);
  });

  it('a company with its own policy gets it', async () => {
    const acme = await makeCompany(w.admin);
    const contact = await makeContact(w.admin, { companyId: acme.id });
    const gold = expectOk(await w.admin.agent.post(`${API}/sla-policies`).send({
      name: 'Gold', companyIds: [acme.id], targets: [{ priority: 'medium', responseMinutes: 15 }],
    }), 201).policy;
    const t = await makeTicket(w.admin.agent, { title: 'Acme', contactId: contact.id, priority: 'medium' });
    const s = await sla(t.id);
    expect([s.slaPolicyId, iso(s.responseDueAt), s.resolutionTargetMinutes]).toEqual([gold.id, at(15), null]);
  });
});

describe('assignment clock', () => {
  it('stops when assigned and restarts, keeping used time, when unassigned', async () => {
    const t = await newTicket();
    advanceClock(10 * MIN);
    await patchTicket(t.id, { assigneeId: tech.user.id });
    let s = await sla(t.id);
    expect([s.assignUsedMinutes, s.assignRunningSince, iso(s.assignMetAt)]).toEqual([10, null, at(10)]);
    advanceClock(60 * MIN);
    await patchTicket(t.id, { assigneeId: null });
    s = await sla(t.id);
    expect([iso(s.assignRunningSince), iso(s.assignDueAt), iso(s.assignMetAt)]).toEqual([at(70), at(90), at(10)]);
  });

  it('a workflow assign action (no request) stops it too', async () => {
    const rule = await WorkflowRule.create({ name: 'To tech', triggerEvent: 'ticket_created', isActive: true });
    await WorkflowAction.create({ ruleId: rule.id, actionType: 'assign_to_user', actionValue: { userId: tech.user.id }, position: 0 });
    const t = await newTicket();
    const s = await sla(t.id);
    expect([s.assignRunningSince, s.assignUsedMinutes]).toEqual([null, 0]);
  });
});

describe('first response clock', () => {
  it('a staff public reply stops it', async () => {
    const t = await newTicket();
    advanceClock(15 * MIN);
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'On it' }), 201);
    const s = await sla(t.id);
    expect([s.responseUsedMinutes, s.responseRunningSince, iso(s.responseMetAt)]).toEqual([15, null, at(15)]);
  });

  it('a private note does not', async () => {
    const t = await newTicket();
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'note', type: 'comment_private' }), 201);
    const s = await sla(t.id);
    expect([iso(s.responseRunningSince), s.responseMetAt]).toEqual([T0, null]);
  });

  it('a customer email reply (stored as a reply by the system account) does not', async () => {
    const t = await newTicket();
    await Comment.create({ body: 'Any news?', authorId: w.admin.user.id, ticketId: t.id, type: 'reply' });
    const s = await sla(t.id);
    expect([iso(s.responseRunningSince), s.responseMetAt]).toEqual([T0, null]);
  });

  it('only the first response counts', async () => {
    const t = await newTicket();
    advanceClock(5 * MIN);
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'one' }), 201);
    advanceClock(5 * MIN);
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'two' }), 201);
    expect(iso((await sla(t.id)).responseMetAt)).toBe(at(5));
  });
});

describe('resolution clock', () => {
  it('a pausing status stops only the resolution clock', async () => {
    expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Waiting on customer', pausesSla: true }), 201);
    const t = await newTicket();
    advanceClock(20 * MIN);
    await patchTicket(t.id, { status: 'Waiting on customer' });
    let s = await sla(t.id);
    expect([s.resolutionRunningSince, s.resolutionUsedMinutes, iso(s.responseRunningSince)]).toEqual([null, 20, T0]);
    advanceClock(100 * MIN);
    await patchTicket(t.id, { status: 'Open' });
    s = await sla(t.id);
    expect([iso(s.resolutionRunningSince), iso(s.resolutionDueAt)]).toEqual([at(120), at(120 + 1420)]);
  });

  it('closing stops every clock; reopening resumes without counting the closed time', async () => {
    const t = await newTicket();
    advanceClock(60 * MIN);
    await patchTicket(t.id, { status: 'Closed' });
    let s = await sla(t.id);
    expect([s.assignRunningSince, s.responseRunningSince, s.resolutionRunningSince, iso(s.resolutionMetAt)]).toEqual([null, null, null, at(60)]);
    expect(s.resolutionUsedMinutes).toBe(60);
    advanceClock(600 * MIN);
    await patchTicket(t.id, { status: 'Open' });
    s = await sla(t.id);
    expect([iso(s.resolutionRunningSince), iso(s.resolutionDueAt), s.resolutionMetAt]).toEqual([at(660), at(660 + 1380), null]);
  });

  it('a clock stopped past its target is breached at its due time', async () => {
    await setStandard([{ priority: 'medium', assignMinutes: 10, responseMinutes: 20, resolutionMinutes: 40 }]);
    const t = await newTicket();
    advanceClock(60 * MIN); // a long jump would expire the login session
    await patchTicket(t.id, { status: 'Closed' });
    const s = await sla(t.id);
    expect([iso(s.resolutionBreachedAt), iso(s.responseBreachedAt), iso(s.assignBreachedAt)]).toEqual([at(40), at(20), at(10)]);
  });
});

describe('changing targets', () => {
  it('a priority change keeps used minutes and moves the due time', async () => {
    const t = await newTicket();
    advanceClock(60 * MIN);
    await patchTicket(t.id, { priority: 'high' }); // Standard high: response 240, resolution 480
    const s = await sla(t.id);
    expect([s.priority, s.responseUsedMinutes, iso(s.responseRunningSince), iso(s.responseDueAt), iso(s.resolutionDueAt)])
      .toEqual(['high', 60, at(60), at(240), at(480)]);
    expect(s.assignTargetMinutes).toBeNull(); // Standard high tracks no assignment time
  });

  it('a policy target edited after creation applies on the next change', async () => {
    const t = await newTicket();
    await setStandard([{ priority: 'high', responseMinutes: 30 }]);
    advanceClock(10 * MIN);
    await patchTicket(t.id, { priority: 'high' });
    expect(iso((await sla(t.id)).responseDueAt)).toBe(at(30));
  });

  it('a ticket from before the SLA engine (no row) stays without one', async () => {
    const t = await newTicket();
    await TicketSla.destroy({ where: { ticketId: t.id } });
    await patchTicket(t.id, { priority: 'high', assigneeId: tech.user.id });
    expect(await sla(t.id)).toBeNull();
  });
});
