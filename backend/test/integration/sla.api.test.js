const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const { runSlaPass } = require('../../src/services/sla/slaScheduler');

// SLA on ticket responses, the Breached / At risk list filters and the
// dashboard's "SLA at risk" panel (sub-project 4). All scoped like the rest
// of the ticket views: a filter can only narrow what the caller sees.

const { SlaPolicy, TicketSla, TicketStatus } = models;
const T0 = '2026-03-09T15:00:00.000Z';
const MIN = 60000;

let w;
let tech;
let std;
const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', ...fields,
});
const ids = (body) => body.tickets.map((t) => t.id).sort();

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  std = await SlaPolicy.findOne({ where: { isDefault: true } });
  // medium: response 10, resolution 100, warn at 50%; high: response 100, resolution 200
  expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({
    warnAtPercent: 50,
    targets: [
      { priority: 'medium', responseMinutes: 10, resolutionMinutes: 100 },
      { priority: 'high', responseMinutes: 100, resolutionMinutes: 200 },
    ],
  }));
  freezeClock(T0);
});
afterEach(unfreezeClock);
afterAll(async () => {
  await TicketStatus.destroy({ where: { name: 'Waiting on customer' } });
  await closeDb();
});

describe('ticket responses', () => {
  it('the ticket detail carries the SLA view', async () => {
    const t = await newTicket();
    advanceClock(6 * MIN);
    const { ticket } = expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`));
    expect(ticket.sla.policy).toEqual({ id: std.id, name: 'Standard' });
    expect(ticket.sla.clocks.assign.state).toBe('untracked');
    expect(ticket.sla.clocks.response).toMatchObject({ state: 'running', targetMinutes: 10, atRisk: true });
    expect(ticket.sla.clocks.resolution).toMatchObject({ state: 'running', atRisk: false });
    expect(ticket.sla.worst).toMatchObject({ clock: 'response', state: 'at_risk' });
    expect(new Date(ticket.sla.worst.dueAt).toISOString()).toBe('2026-03-09T15:10:00.000Z');
  });

  it('a ticket from before the SLA engine shows no SLA', async () => {
    const t = await newTicket();
    await TicketSla.destroy({ where: { ticketId: t.id } });
    expect(expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket.sla).toBeNull();
  });

  it('a paused resolution clock shows as paused, a met response as met', async () => {
    expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Waiting on customer', pausesSla: true }), 201);
    const t = await newTicket();
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'On it' }), 201);
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Waiting on customer' }));
    const { sla } = expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket;
    expect([sla.clocks.response.state, sla.clocks.resolution.state, sla.worst]).toEqual(['met', 'paused', null]);
  });

  it('the list carries the SLA view too', async () => {
    await newTicket();
    const body = expectOk(await w.admin.agent.get(`${API}/tickets`));
    expect(body.tickets[0].sla.clocks.response.state).toBe('running');
  });
});

describe('list filters', () => {
  async function scenario() {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const mineBreached = await newTicket({ title: 'mine', assigneeId: own.user.id });
    const otherBreached = await newTicket({ title: 'other', assigneeId: tech.user.id });
    const atRisk = await newTicket({ title: 'risky', priority: 'high' });
    advanceClock(60 * MIN); // medium response (10) breached; high response warns at 50
    await runSlaPass(new Date());
    return {
      own, mineBreached, otherBreached, atRisk,
    };
  }

  it('Breached lists only breached tickets the caller can see', async () => {
    const s = await scenario();
    const all = expectOk(await w.admin.agent.get(`${API}/tickets?sla=breached`));
    expect(ids(all)).toEqual([s.mineBreached.id, s.otherBreached.id].sort());
    const mine = expectOk(await s.own.agent.get(`${API}/tickets?sla=breached`));
    expect([ids(mine), mine.total]).toEqual([[s.mineBreached.id], 1]);
  });

  it('At risk excludes breached tickets', async () => {
    const s = await scenario();
    expect(ids(expectOk(await w.admin.agent.get(`${API}/tickets?sla=at_risk`)))).toEqual([s.atRisk.id]);
  });

  it('closed tickets are not listed', async () => {
    const s = await scenario();
    expectOk(await w.admin.agent.patch(`${API}/tickets/${s.otherBreached.id}`).send({ status: 'Closed' }));
    expect(ids(expectOk(await w.admin.agent.get(`${API}/tickets?sla=breached`)))).toEqual([s.mineBreached.id]);
  });

  it('rejects an unknown value', async () => {
    const res = await w.admin.agent.get(`${API}/tickets?sla=late`);
    expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});

describe('dashboard', () => {
  it('lists the caller\'s breached and at-risk tickets, most urgent first', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const mine = await newTicket({ title: 'mine', assigneeId: own.user.id });
    const risky = await newTicket({ title: 'risky', priority: 'high', assigneeId: own.user.id });
    await newTicket({ title: 'not mine', assigneeId: tech.user.id });
    advanceClock(60 * MIN);
    await runSlaPass(new Date());
    const { slaAtRisk } = expectOk(await own.agent.get(`${API}/dashboard`));
    expect(slaAtRisk.map((t) => [t.id, t.sla.worst.state])).toEqual([[mine.id, 'breached'], [risky.id, 'at_risk']]);
    const admin = expectOk(await w.admin.agent.get(`${API}/dashboard`)).slaAtRisk;
    expect(admin.map((t) => t.title).sort()).toEqual(['mine', 'not mine', 'risky']);
  });
});
