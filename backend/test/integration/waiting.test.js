const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, makeCompany, makeContact,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const migration = require('../../migrations/20260101000065-waiting-on-customer');
const { loadTicketReportData } = require('../../src/services/ticketReport');

// Time waiting on the customer (user decisions 2026-10-15): read from the
// status activity log, statuses opt in with "counts as waiting", lifecycle
// times and the SLA unchanged.

const { TicketStatus, TicketActivity } = models;
const H = 3600000;
const T0 = '2026-03-09T12:00:00.000Z';
const RANGE = 'startDate=2026-03-01&endDate=2026-03-31';

let w;
let tech;
let acme;
let acmeContact;
let statusSnapshot;

const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', ...fields,
});
const setStatus = async (t, status) => expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status }));
const statusId = async (name) => (await TicketStatus.findOne({ where: { name } })).id;
const patchStatus = (id, body) => w.admin.agent.patch(`${API}/ticket-statuses/${id}`).send(body);
const statusLog = async (t) => (await TicketActivity.findAll({ where: { ticketId: t.id, action: 'status' }, order: [['id', 'ASC']] }))
  .map((r) => [r.fromValue, r.toValue]);

// a: Open 1h → Waiting on User 3h → Open 2h → Request completed (life 6h, waiting 3h)
// b (Acme, tech): Open 1h → Waiting on User, still waiting at +6h (life 6h, waiting 5h)
async function story() {
  const a = await newTicket({ title: 'a' });
  const b = await newTicket({
    title: 'b', contactId: acmeContact.id, departmentId: null, assigneeId: tech.user.id,
  });
  advanceClock(H);
  await setStatus(a, 'Waiting on User');
  await setStatus(b, 'Waiting on User');
  advanceClock(3 * H);
  await setStatus(a, 'Open');
  advanceClock(2 * H);
  await setStatus(a, 'Request completed');
  return { a, b };
}

beforeEach(async () => {
  await resetData();
  if (!statusSnapshot) statusSnapshot = (await TicketStatus.findAll()).map((s) => s.get({ plain: true }));
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
  acme = await makeCompany(w.admin);
  acmeContact = await makeContact(w.admin, { companyId: acme.id });
  freezeClock(T0);
});
// TicketStatuses survive resetData: put back whatever a test changed.
afterEach(async () => {
  unfreezeClock();
  const ids = statusSnapshot.map((s) => s.id);
  await TicketStatus.destroy({ where: { id: { [Sequelize.Op.notIn]: ids } } });
  // eslint-disable-next-line no-restricted-syntax
  for (const s of statusSnapshot) {
    // eslint-disable-next-line no-await-in-loop
    await TicketStatus.update({ name: s.name, countsAsWaiting: s.countsAsWaiting }, { where: { id: s.id } });
  }
});
afterAll(closeDb);

describe('migration', () => {
  it('adds the switch, on for Waiting on User only, and renames 064\'s old names in the activity log', async () => {
    // The ticket first: TicketStatus reads fail while the column is gone.
    const t = await newTicket();
    await migration.down(sequelize.getQueryInterface(), Sequelize);
    try {
      expect((await sequelize.getQueryInterface().describeTable('TicketStatuses')).countsAsWaiting).toBeUndefined();
      await TicketActivity.bulkCreate([
        { ticketId: t.id, action: 'status', fromValue: 'In Progress', toValue: 'Pending' },
        { ticketId: t.id, action: 'status', fromValue: 'Pending', toValue: 'Resolved' },
        { ticketId: t.id, action: 'priority', fromValue: 'Pending', toValue: 'high' },
      ]);
    } finally {
      await migration.up(sequelize.getQueryInterface(), Sequelize);
    }
    const rows = await TicketActivity.findAll({ where: { ticketId: t.id, action: ['status', 'priority'] }, order: [['id', 'ASC']] });
    expect(rows.map((r) => [r.action, r.fromValue, r.toValue])).toEqual([
      ['status', 'Open', 'On Hold'],
      ['status', 'On Hold', 'Request completed'],
      ['priority', 'Pending', 'high'],
    ]);
    const on = await TicketStatus.findAll({ where: { countsAsWaiting: true } });
    expect(on.map((s) => s.systemKey)).toEqual(['waiting_on_user']);
  });

  it('leaves an old name alone when a status has that name today', async () => {
    const pending = await TicketStatus.create({ name: 'Pending', behaviorType: 'open' });
    const t = await newTicket();
    await migration.down(sequelize.getQueryInterface(), Sequelize);
    try {
      await TicketActivity.create({ ticketId: t.id, action: 'status', fromValue: 'Open', toValue: 'Pending' });
    } finally {
      await migration.up(sequelize.getQueryInterface(), Sequelize);
    }
    expect(await statusLog(t)).toEqual([['Open', 'Pending']]);
    await pending.destroy();
  });
});

describe('statuses', () => {
  it('lists, creates and switches "counts as waiting"', async () => {
    const { statuses } = expectOk(await w.admin.agent.get(`${API}/ticket-statuses`));
    expect(statuses.find((s) => s.name === 'Waiting on User').countsAsWaiting).toBe(true);
    expect(statuses.find((s) => s.name === 'On Hold').countsAsWaiting).toBe(false);
    const created = expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'With customer IT', behaviorType: 'on_hold', countsAsWaiting: true }), 201).status;
    expect(created.countsAsWaiting).toBe(true);
    const updated = expectOk(await patchStatus(await statusId('On Hold'), { countsAsWaiting: true })).status;
    expect(updated.countsAsWaiting).toBe(true);
  });

  it('keeps the switch on for Waiting on User', async () => {
    const res = await patchStatus(await statusId('Waiting on User'), { countsAsWaiting: false });
    expect(res.status).toBe(400);
  });

  it('refuses a switch value that is not true or false', async () => {
    expect((await patchStatus(await statusId('On Hold'), { countsAsWaiting: 'yes' })).status).toBe(400);
  });

  it('needs the manage-statuses permission', async () => {
    const res = await tech.agent.patch(`${API}/ticket-statuses/${await statusId('On Hold')}`).send({ countsAsWaiting: true });
    expect(res.status).toBe(403);
  });

  it('a rename rewrites the status activity log', async () => {
    const t = await newTicket();
    advanceClock(H);
    await setStatus(t, 'Waiting on User');
    expectOk(await patchStatus(await statusId('Waiting on User'), { name: 'Waiting on customer' }));
    expect(await statusLog(t)).toEqual([['Open', 'Waiting on customer']]);
    advanceClock(H);
    const { ticket } = expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`));
    expect(ticket.waiting.minutes).toBe(60);
  });

  it('deleting a status logs the move of each of its tickets', async () => {
    const temp = expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Temp hold', behaviorType: 'on_hold' }), 201).status;
    const t = await newTicket();
    await setStatus(t, 'Temp hold');
    expectOk(await w.admin.agent.delete(`${API}/ticket-statuses/${temp.id}`));
    const last = await TicketActivity.findOne({ where: { ticketId: t.id, action: 'status' }, order: [['id', 'DESC']] });
    expect([last.fromValue, last.toValue, last.userId]).toEqual(['Temp hold', 'Open', w.admin.user.id]);
  });
});

it('a workflow rule\'s status change is logged', async () => {
  expectOk(await w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Ask first', triggerEvent: 'ticket_created', actions: [{ actionType: 'set_status', actionValue: { status: 'Waiting on User' } }],
  }), 201);
  const t = await newTicket();
  const rows = await TicketActivity.findAll({ where: { ticketId: t.id, action: 'status' } });
  expect(rows.map((r) => [r.fromValue, r.toValue, r.userId])).toEqual([['Open', 'Waiting on User', null]]);
});

describe('on the ticket', () => {
  it('shows the waiting time and share of its life', async () => {
    const { a, b } = await story();
    const get = async (t) => expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket.waiting;
    expect(await get(a)).toEqual({ minutes: 180, lifeMinutes: 360, pct: 50, now: false });
    expect(await get(b)).toEqual({ minutes: 300, lifeMinutes: 360, pct: 83, now: true });
  });

  it('follows the switch backwards in time', async () => {
    const t = await newTicket();
    advanceClock(H);
    await setStatus(t, 'On Hold');
    advanceClock(2 * H);
    await setStatus(t, 'Open');
    const get = async () => expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket.waiting.minutes;
    expect(await get()).toBe(0);
    expectOk(await patchStatus(await statusId('On Hold'), { countsAsWaiting: true }));
    expect(await get()).toBe(120);
  });

  it('is in the ticket PDF data', async () => {
    const { a } = await story();
    expect((await loadTicketReportData(a.id)).waiting).toEqual({ minutes: 180, lifeMinutes: 360, pct: 50, now: false });
  });
});

describe('ticket volume report', () => {
  it('has waiting columns', async () => {
    await story();
    const { tableData } = expectOk(await w.admin.agent.get(`${API}/reports/ticket-volume?${RANGE}`));
    expect(tableData.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['waitingHours', 'waitingPct']));
    const byTitle = Object.fromEntries(tableData.rows.map((r) => [r.title, [r.waitingHours, r.waitingPct]]));
    expect(byTitle).toEqual({ a: [3, 50], b: [5, 83] });
  });
});

describe('waiting on customer report', () => {
  const report = async (agent = w.admin.agent, extra = '') => expectOk(await agent.get(`${API}/reports/customer-waiting?${RANGE}${extra}`));

  it('totals and averages overall, per tech, per company and per period', async () => {
    await story();
    const r = await report();
    expect(r.summary).toEqual({
      tickets: 2, waitingHours: 8, avgWaitingHours: 4, lifeHours: 12, pctWaiting: 67, waitingNow: 1,
    });
    expect(r.byTech).toEqual([
      { name: 'Unassigned', tickets: 1, waitingHours: 3, avgWaitingHours: 3, pctWaiting: 50 },
      { name: tech.user.displayName, tickets: 1, waitingHours: 5, avgWaitingHours: 5, pctWaiting: 83 },
    ]);
    expect(r.byCompany).toHaveLength(2);
    expect(r.byCompany).toContainEqual({ name: acme.name, tickets: 1, waitingHours: 5, avgWaitingHours: 5, pctWaiting: 83 });
    expect(r.byPeriod).toEqual([{ date: expect.any(String), tickets: 2, waitingHours: 8, avgWaitingHours: 4, pctWaiting: 67 }]);
    expect(r.tableData.rows.map((row) => [row.title, row.lifeHours, row.waitingHours, row.waitingPct, row.waitingNow])).toEqual([
      ['a', 6, 3, 50, false], ['b', 6, 5, 83, true],
    ]);
  });

  it('can count closed tickets only', async () => {
    await story();
    const r = await report(w.admin.agent, '&closedOnly=true');
    expect(r.summary.tickets).toBe(1);
    expect(r.tableData.rows.map((row) => row.title)).toEqual(['a']);
  });

  it('respects ticket scope and the company filter', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    await story();
    expect((await report(own.agent)).summary.tickets).toBe(0);
    const acmeOnly = await report(w.admin.agent, `&companyId=${acme.id}`);
    expect(acmeOnly.tableData.rows.map((row) => row.title)).toEqual(['b']);
  });

  it('only counts tickets created in the range', async () => {
    await story();
    expect((await expectOk(await w.admin.agent.get(`${API}/reports/customer-waiting?startDate=2026-04-01&endDate=2026-04-30`))).summary.tickets).toBe(0);
  });

  it('exports the tickets as CSV', async () => {
    await story();
    const res = await w.admin.agent.get(`${API}/reports/customer-waiting/export?${RANGE}`);
    expect(res.status).toBe(200);
    const rows = res.text.split('\r\n').filter(Boolean);
    expect(rows[0]).toBe('Ticket #,Title,Status,Assignee,Company,Created,Closed,Life (hrs),Waiting (hrs),% waiting,Waiting now');
    expect(rows).toHaveLength(3);
  });
});
