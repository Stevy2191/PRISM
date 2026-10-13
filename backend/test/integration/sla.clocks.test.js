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

describe('changing statuses that tickets are in', () => {
  afterEach(async () => { await TicketStatus.destroy({ where: { name: ['Done', 'Waiting on customer'] } }); });

  it('deleting a closed status reopens its tickets\' resolution clock', async () => {
    expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Done', behaviorType: 'closed' }), 201);
    const t = await newTicket();
    advanceClock(10 * MIN);
    await patchTicket(t.id, { status: 'Done' });
    advanceClock(50 * MIN);
    const done = await TicketStatus.findOne({ where: { name: 'Done' } });
    expectOk(await w.admin.agent.delete(`${API}/ticket-statuses/${done.id}`));
    const s = await sla(t.id);
    expect([iso(s.resolutionRunningSince), s.resolutionMetAt, s.resolutionUsedMinutes]).toEqual([at(60), null, 10]);
  });

  it('unticking Pauses SLA resumes the tickets paused in that status', async () => {
    const { status } = expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Waiting on customer', pausesSla: true }), 201);
    const t = await newTicket();
    advanceClock(10 * MIN);
    await patchTicket(t.id, { status: 'Waiting on customer' });
    advanceClock(30 * MIN);
    expectOk(await w.admin.agent.patch(`${API}/ticket-statuses/${status.id}`).send({ pausesSla: false }));
    const s = await sla(t.id);
    expect([iso(s.resolutionRunningSince), s.resolutionUsedMinutes]).toEqual([at(40), 10]);
  });

  it('making a status closed stops the clocks of the tickets in it', async () => {
    const { status } = expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Done' }), 201);
    const t = await newTicket();
    await patchTicket(t.id, { status: 'Done' });
    advanceClock(15 * MIN);
    expectOk(await w.admin.agent.patch(`${API}/ticket-statuses/${status.id}`).send({ behaviorType: 'closed' }));
    const s = await sla(t.id);
    expect([s.resolutionRunningSince, s.resolutionUsedMinutes, iso(s.resolutionMetAt)]).toEqual([null, 15, at(15)]);
  });
});

describe('unusable business-hours schedules', () => {
  afterEach(async () => { await models.BusinessHours.destroy({ where: {} }); });
  const closedWeek = () => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((d) => [d, { start: '09:00', end: '17:00', enabled: false }]));

  it('a schedule with no open time counts every hour instead of failing ticket creation', async () => {
    const bh = await models.BusinessHours.create({ name: 'Closed', timezone: 'UTC', schedule: closedWeek() });
    await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({ businessHoursId: bh.id });
    const t = await newTicket();
    expect(iso((await sla(t.id)).responseDueAt)).toBe(at(480));
  });

  it('a schedule with an unknown time zone counts every hour too', async () => {
    const week = closedWeek();
    week.monday.enabled = true;
    const bh = await models.BusinessHours.create({ name: 'Odd', timezone: 'Mars/Olympus', schedule: week });
    await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({ businessHoursId: bh.id });
    const t = await newTicket();
    expect(iso((await sla(t.id)).responseDueAt)).toBe(at(480));
  });

  it('the business-hours API refuses an unknown time zone or a malformed time', async () => {
    const week = closedWeek();
    const post = (b) => w.admin.agent.post(`${API}/business-hours`).send({ name: 'X', schedule: week, ...b });
    expect((await post({ timezone: 'Mars/Olympus' })).status).toBe(400);
    week.monday = { start: 9, end: '17:00', enabled: true };
    expect((await post({ timezone: 'UTC', schedule: week })).status).toBe(400);
    week.monday = { start: '09:00', end: '25:00', enabled: true };
    expect((await post({ timezone: 'UTC', schedule: week })).status).toBe(400);
    week.monday = { start: '09:00', end: '17:00', enabled: true };
    expect((await post({ timezone: 'UTC', schedule: week })).status).toBe(201);
  });
});

describe('under load', () => {
  it('ten tickets saved in ten open transactions at once all get clocks (no second connection needed)', async () => {
    unfreezeClock();
    require('../../src/services/sla/calendar').invalidate(); // eslint-disable-line global-require
    const internal = await models.Company.findOne({ where: { isInternal: true } });
    // The pool holds 10 connections: every one is busy with a transaction,
    // so an SLA lookup outside the transaction would wait for an 11th.
    await Promise.all(Array.from({ length: 10 }, (_, i) => models.sequelize.transaction((transaction) => models.Ticket.create({
      title: `Load ${i}`, companyId: internal.id, contactId: w.contact.id, departmentId: w.deptA.id, createdBy: w.admin.user.id, status: 'Open',
    }, { transaction }))));
    expect(await TicketSla.count()).toBe(10);
  }, 15000);
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
