const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, makeCompany, makeContact, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const { recalcTicketSla } = require('../../src/services/sla/ticketSla');
const { runSlaPass } = require('../../src/services/sla/slaScheduler');

// SLA due dates (spec 2026-10-13 change): the resolution target fixes the
// ticket's due date at creation, from its type and priority; nothing pauses
// it; later changes don't move it.

const {
  SlaPolicy, TicketSla, TicketStatus, BusinessHours, SystemSettings, Ticket, TicketDueDateChange, Blueprint,
  TicketActivity, AuditLog, WorkflowRule, WorkflowAction,
} = models;
const T0 = '2026-03-10T19:15:00.000Z'; // Tue 14:15 in Chicago (CDT)
const MIN = 60000;
const at = (min) => new Date(new Date(T0).getTime() + min * MIN).toISOString();
const iso = (d) => (d ? new Date(d).toISOString() : d);

let w;
let std;
const sla = (ticketId) => TicketSla.findOne({ where: { ticketId } });
const setStandard = async (fields) => expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send(fields));
const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, type: 'incident', priority: 'high', ...fields,
});
const weekdays = () => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  .map((d, i) => [d, { start: '09:00', end: '17:00', enabled: i < 5 }]));

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  std = await SlaPolicy.findOne({ where: { isDefault: true } });
  await setStandard({
    targets: [
      { ticketType: 'incident', priority: 'high', resolutionMinutes: 240 },
      { ticketType: 'request', priority: 'high', resolutionMinutes: 600 },
      { ticketType: 'change', priority: 'high', resolutionMinutes: 90 },
    ],
  });
  freezeClock(T0);
});
afterEach(unfreezeClock);
afterAll(async () => {
  await BusinessHours.destroy({ where: {} });
  await TicketStatus.destroy({ where: { name: 'Waiting on customer' } });
  await closeDb();
});

it("the due date comes from the ticket's type and priority", async () => {
  const incident = await newTicket();
  const request = await newTicket({ type: 'request' });
  expect(iso((await sla(incident.id)).resolutionDueAt)).toBe(at(240));
  expect(iso((await sla(request.id)).resolutionDueAt)).toBe(at(600));
  const row = await sla(incident.id);
  expect(iso(row.resolutionOriginalDueAt)).toBe(at(240));
  const fresh = await Ticket.findByPk(incident.id);
  expect([fresh.dueDate, String(fresh.dueTime).slice(0, 5)]).toEqual(['2026-03-10', '23:15']); // org time zone UTC
});

it('a Request/Low 20-business-day target lands 20 open days later at the same time', async () => {
  const bh = await BusinessHours.create({ name: 'Office', timezone: 'America/Chicago', schedule: weekdays() });
  await setStandard({
    businessHoursId: bh.id,
    targets: [{ ticketType: 'request', priority: 'low', resolutionMinutes: 20, resolutionUnit: 'business_days' }],
  });
  const t = await newTicket({ type: 'request', priority: 'low' });
  expect(iso((await sla(t.id)).resolutionDueAt)).toBe('2026-04-07T19:15:00.000Z');
});

it("the company's policy wins over the default", async () => {
  const acme = await makeCompany(w.admin);
  const contact = await makeContact(w.admin, { companyId: acme.id });
  expectOk(await w.admin.agent.post(`${API}/sla-policies`).send({
    name: 'Gold', companyIds: [acme.id], targets: [{ ticketType: 'incident', priority: 'high', resolutionMinutes: 60 }],
  }), 201);
  const t = await makeTicket(w.admin.agent, { title: 'Acme', contactId: contact.id, type: 'incident', priority: 'high' });
  expect(iso((await sla(t.id)).resolutionDueAt)).toBe(at(60));
});

it('a blueprint ticket gets the SLA of its type and priority', async () => {
  const bp = await Blueprint.create({ name: 'New computer', defaultType: 'change', defaultPriority: 'high', type: 'change', createdById: w.admin.user.id });
  const t = await newTicket({ type: 'change', priority: 'high', blueprintId: bp.id });
  expect(iso((await sla(t.id)).resolutionDueAt)).toBe(at(90));
});

it('the mirrored due date uses the organization time zone across the UTC date line', async () => {
  await SystemSettings.upsert({ key: 'company.timezone', value: 'America/Chicago' });
  unfreezeClock();
  freezeClock('2026-03-10T03:00:00.000Z'); // 22:00 CDT on Mar 9
  const t = await newTicket({ type: 'change' }); // due +90 min = 23:30 CDT Mar 9 = 04:30Z Mar 10
  const fresh = await Ticket.findByPk(t.id);
  expect([fresh.dueDate, String(fresh.dueTime).slice(0, 5)]).toEqual(['2026-03-09', '23:30']);
});

it('priority, type and company changes leave every SLA date alone', async () => {
  const t = await newTicket();
  const before = (await sla(t.id)).toJSON();
  advanceClock(10 * MIN);
  const acme = await makeCompany(w.admin);
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'low', type: 'request' }));
  await Ticket.update({ companyId: acme.id }, { where: { id: t.id }, individualHooks: true });
  const after = await sla(t.id);
  expect([iso(after.resolutionDueAt), iso(after.responseDueAt), after.priority, after.ticketType, after.slaPolicyId])
    .toEqual([iso(before.resolutionDueAt), iso(before.responseDueAt), 'high', 'incident', std.id]);
});

it('a formerly pausing status no longer stops the clock', async () => {
  expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Waiting on customer' }), 201);
  const t = await newTicket();
  advanceClock(10 * MIN);
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Waiting on customer' }));
  expect(iso((await sla(t.id)).resolutionRunningSince)).toBe(T0);
});

it('reopening keeps the original due date and is breached if past it', async () => {
  const t = await newTicket({ type: 'change' }); // due +90
  advanceClock(10 * MIN);
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Closed' }));
  let s = await sla(t.id);
  expect([s.resolutionRunningSince, iso(s.resolutionDueAt), iso(s.resolutionMetAt), s.resolutionBreachedAt]).toEqual([null, at(90), at(10), null]);
  advanceClock(90 * MIN);
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Open' }));
  s = await sla(t.id);
  expect([iso(s.resolutionRunningSince), iso(s.resolutionDueAt), iso(s.resolutionBreachedAt), s.resolutionMetAt]).toEqual([at(100), at(90), at(90), null]);
});

it('Set SLA policy after an extension recomputes the original and current due date and keeps the history', async () => {
  const t = await newTicket();
  await TicketSla.update({ resolutionDueAt: at(500) }, { where: { ticketId: t.id } });
  await TicketDueDateChange.create({ ticketId: t.id, userId: w.admin.user.id, fromDueAt: at(240), toDueAt: at(500), reason: 'Parts', kind: 'extension' });
  const gold = expectOk(await w.admin.agent.post(`${API}/sla-policies`).send({
    name: 'Gold', targets: [{ ticketType: 'incident', priority: 'high', resolutionMinutes: 120 }],
  }), 201).policy;
  advanceClock(5 * MIN);
  await recalcTicketSla(t.id, { policyId: gold.id });
  const s = await sla(t.id);
  expect([s.slaPolicyId, iso(s.resolutionDueAt), iso(s.resolutionOriginalDueAt)]).toEqual([gold.id, at(120), at(120)]);
  expect(await TicketDueDateChange.count({ where: { ticketId: t.id } })).toBe(1);
  expect((await Ticket.findByPk(t.id)).dueDate).toBe('2026-03-10');
});

describe('changing the due date', () => {
  // Incident/High is due at +240 = 23:15Z on 2026-03-10 (org time zone UTC).
  let tech;
  beforeEach(async () => { tech = await makeTech('tech', w.deptA.id); });
  const move = (agent, id, body) => agent.post(`${API}/tickets/${id}/due-date`).send(body);
  const err = (res) => [res.status, res.body.code];

  it('a later date with a reason extends it, with history, activity and audit', async () => {
    const t = await newTicket();
    const { ticket } = expectOk(await move(tech.agent, t.id, { dueDate: '2026-03-11', dueTime: '09:00', reason: 'Waiting on parts' }));
    expect(iso(ticket.sla.clocks.resolution.dueAt)).toBe('2026-03-11T09:00:00.000Z');
    expect(iso(ticket.sla.clocks.resolution.originalDueAt)).toBe(at(240));
    expect(ticket.sla.changes.map((c) => [c.kind, c.reason, c.user.id, iso(c.fromDueAt), iso(c.toDueAt)]))
      .toEqual([['extension', 'Waiting on parts', tech.user.id, at(240), '2026-03-11T09:00:00.000Z']]);
    expect((await Ticket.findByPk(t.id)).dueDate).toBe('2026-03-11');
    expect(await TicketActivity.count({ where: { ticketId: t.id, action: 'due_date_extended' } })).toBe(1);
    expect(await AuditLog.count({ where: { action: 'ticket.dueDate.change' } })).toBe(1);
    const detail = expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket;
    expect(detail.sla.changes).toHaveLength(1);
  });

  it('an earlier date needs Adjust SLA due dates', async () => {
    const t = await newTicket();
    expect(err(await move(tech.agent, t.id, { dueDate: '2026-03-10', dueTime: '20:00', reason: 'Customer asked' }))).toEqual([403, 'FORBIDDEN']);
    const { ticket } = expectOk(await move(w.admin.agent, t.id, { dueDate: '2026-03-10', dueTime: '20:00', reason: 'Customer asked' }));
    expect(ticket.sla.changes.map((c) => c.kind)).toEqual(['adjustment']);
  });

  it('a change without a reason needs Adjust SLA due dates', async () => {
    const t = await newTicket();
    expect(err(await move(tech.agent, t.id, { dueDate: '2026-03-12', dueTime: '09:00', reason: '  ' }))).toEqual([403, 'FORBIDDEN']);
    const { ticket } = expectOk(await move(w.admin.agent, t.id, { dueDate: '2026-03-12', dueTime: '09:00' }));
    expect(ticket.sla.changes.map((c) => [c.kind, c.reason])).toEqual([['adjustment', null]]);
  });

  it('the same date is refused', async () => {
    const t = await newTicket();
    expect(err(await move(w.admin.agent, t.id, { dueDate: '2026-03-10', dueTime: '23:15', reason: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('bad dates, times and over-long reasons are refused', async () => {
    const t = await newTicket();
    for (const body of [
      { dueDate: '2026-02-30', dueTime: '09:00', reason: 'x' },
      { dueDate: '2026-03-12', dueTime: '9am', reason: 'x' },
      { dueDate: '2026-03-12', dueTime: '24:00', reason: 'x' },
      { dueDate: '2026-03-12', dueTime: '09:00', reason: 'x'.repeat(1001) },
      { dueDate: '2026-03-12', dueTime: '09:00', reason: 42 },
    ]) expect(err(await move(tech.agent, t.id, body))).toEqual([400, 'VALIDATION_ERROR']); // eslint-disable-line no-await-in-loop
  });

  it('an extension lets the warning and breach fire again for the new date', async () => {
    const t = await newTicket({ type: 'change' }); // due +90
    advanceClock(100 * MIN);
    await runSlaPass(new Date());
    expect((await sla(t.id)).resolutionBreachedAt).not.toBeNull();
    expectOk(await move(tech.agent, t.id, { dueDate: '2026-03-10', dueTime: '22:15', reason: 'Vendor delay' })); // +180
    let s = await sla(t.id);
    expect([s.resolutionBreachedAt, s.resolutionWarnedAt]).toEqual([null, null]);
    advanceClock(85 * MIN);
    await runSlaPass(new Date());
    s = await sla(t.id);
    expect(iso(s.resolutionBreachedAt)).toBe(at(180));
  });

  it('PATCH can no longer change the due date of an SLA ticket', async () => {
    const t = await newTicket();
    expect(err(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ dueDate: '2026-04-01' }))).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('a ticket with no resolution target keeps its manual due date', async () => {
    const t = await newTicket({ type: 'problem', priority: 'low' });
    expect((await sla(t.id)).resolutionDueAt).toBeNull();
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ dueDate: '2026-04-01' }));
    expect((await Ticket.findByPk(t.id)).dueDate).toBe('2026-04-01');
    expect(err(await move(w.admin.agent, t.id, { dueDate: '2026-04-02', dueTime: '09:00', reason: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
  });

  it("a user who can't see the ticket is refused as on any other ticket route", async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const t = await newTicket({ assigneeId: tech.user.id });
    const res = await move(own.agent, t.id, { dueDate: '2026-03-12', dueTime: '09:00', reason: 'x' });
    expect(res.status).toBe(403);
    expect(await TicketDueDateChange.count()).toBe(0);
    expect((await move(own.agent, 999999, { dueDate: '2026-03-12', dueTime: '09:00', reason: 'x' })).status).toBe(404);
  });

  it("a workflow rule's due date is recorded as an adjustment by the rule", async () => {
    const rule = await WorkflowRule.create({ name: 'Two-day', triggerEvent: 'ticket_created', isActive: true });
    await WorkflowAction.create({ ruleId: rule.id, actionType: 'set_due_date', actionValue: { amount: 2, unit: 'days' }, position: 0 });
    const t = await newTicket();
    const [change] = await TicketDueDateChange.findAll({ where: { ticketId: t.id } });
    expect([change.kind, change.userId, change.reason]).toEqual(['adjustment', null, 'Workflow rule: Two-day']);
    expect((await Ticket.findByPk(t.id)).dueDate).toBe('2026-03-12');
  });
});
