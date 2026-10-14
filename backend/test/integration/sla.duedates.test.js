const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeCompany, makeContact, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const { recalcTicketSla } = require('../../src/services/sla/ticketSla');

// SLA due dates (spec 2026-10-13 change): the resolution target fixes the
// ticket's due date at creation, from its type and priority; nothing pauses
// it; later changes don't move it.

const {
  SlaPolicy, TicketSla, TicketStatus, BusinessHours, SystemSettings, Ticket, TicketDueDateChange, Blueprint,
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
