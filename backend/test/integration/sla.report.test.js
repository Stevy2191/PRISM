const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, makeCompany, makeContact,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');
const { runSlaPass } = require('../../src/services/sla/slaScheduler');

// SLA compliance report on real SLA clocks (sub-project 4).

const { SlaPolicy, TicketSla } = models;
const T0 = '2026-03-09T15:00:00.000Z';
const MIN = 60000;
const RANGE = 'startDate=2026-03-01&endDate=2026-03-31';

let w;
let tech;
const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', ...fields,
});
const comment = async (t) => expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'On it' }), 201);
const close = async (t) => expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Closed' }));

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  const std = await SlaPolicy.findOne({ where: { isDefault: true } });
  // medium: assign 5, response 10, resolution 30
  expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({
    targets: [{ ticketType: 'request', priority: 'medium', assignMinutes: 5, responseMinutes: 10, resolutionMinutes: 30 }],
  }));
  freezeClock(T0);
});
afterEach(unfreezeClock);
afterAll(closeDb);

// fast: assigned at once, answered at 2 min, closed at 20 → all met
// slow: assigned at 8, answered at 15, closed at 40 → all breached
async function twoTickets() {
  const fast = await newTicket({ title: 'fast', assigneeId: tech.user.id });
  const slow = await newTicket({ title: 'slow' });
  advanceClock(2 * MIN); await comment(fast);
  advanceClock(6 * MIN);
  expectOk(await w.admin.agent.patch(`${API}/tickets/${slow.id}`).send({ assigneeId: tech.user.id }));
  advanceClock(7 * MIN); await comment(slow);
  advanceClock(5 * MIN); await close(fast);
  advanceClock(20 * MIN); await close(slow);
  return { fast, slow };
}

it('counts met and breached per clock', async () => {
  await twoTickets();
  const { summary, chartData } = expectOk(await w.admin.agent.get(`${API}/reports/sla-compliance?${RANGE}`));
  expect(summary.clocks.assign).toEqual({ tracked: 2, met: 1, breached: 1, pctMet: 50 });
  expect(summary.clocks.response).toEqual({ tracked: 2, met: 1, breached: 1, pctMet: 50 });
  expect(summary.clocks.resolution).toEqual({ tracked: 2, met: 1, breached: 1, pctMet: 50 });
  expect(chartData.metVsBreachedByTech).toEqual([{ name: tech.user.displayName, met: 1, breached: 1 }]);
});

it('counts open tickets that are breached or at risk', async () => {
  await newTicket();
  advanceClock(12 * MIN);
  await runSlaPass(new Date());
  const { summary } = expectOk(await w.admin.agent.get(`${API}/reports/sla-compliance?${RANGE}`));
  expect([summary.openBreached, summary.openAtRisk]).toEqual([1, 0]);
});

it('leaves out tickets without SLA clocks', async () => {
  const { fast } = await twoTickets();
  await TicketSla.destroy({ where: { ticketId: fast.id } });
  const { summary } = expectOk(await w.admin.agent.get(`${API}/reports/sla-compliance?${RANGE}`));
  expect(summary.clocks.resolution).toEqual({ tracked: 1, met: 0, breached: 1, pctMet: 0 });
});

it('respects ticket scope and the company filter', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  await twoTickets(); // assigned to tech, not visible to own
  const acme = await makeCompany(w.admin);
  const acmeContact = await makeContact(w.admin, { companyId: acme.id });
  await makeTicket(w.admin.agent, { title: 'acme', contactId: acmeContact.id, priority: 'medium', assigneeId: own.user.id });
  const mine = expectOk(await own.agent.get(`${API}/reports/sla-compliance?${RANGE}`));
  expect(mine.summary.clocks.response.tracked).toBe(0); // acme ticket is still running: not met, not breached
  const acmeOnly = expectOk(await w.admin.agent.get(`${API}/reports/sla-compliance?${RANGE}&companyId=${acme.id}`));
  expect(acmeOnly.summary.clocks.resolution.tracked).toBe(0);
  expect(acmeOnly.tableData.rows).toEqual([]);
});

it('exports the breaches as CSV', async () => {
  await twoTickets();
  const res = await w.admin.agent.get(`${API}/reports/sla-compliance/export?${RANGE}`);
  expect(res.status).toBe(200);
  const rows = res.text.split('\r\n').filter(Boolean);
  expect(rows[0]).toBe('Ticket #,Title,Assignee,Company,Clock,Due,Minutes over');
  expect(rows.slice(1).map((r) => r.split(',').slice(1, 2).concat(r.split(',').slice(4, 5)))).toEqual([
    ['slow', 'Assignment'], ['slow', 'First response'], ['slow', 'Resolution'],
  ]);
  expect(rows.slice(1).map((r) => r.split(',')[6])).toEqual(['3', '5', '10']);
});
