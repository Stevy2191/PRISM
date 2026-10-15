jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const { runDueRecurring } = require('../../src/services/recurring/recurringScheduler');
const { nextRun } = require('../../src/services/recurring/schedule');
const {
  API, expectOk, makeWorld, makeTech, makeContact, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Service desk 5b task 10: the recurring scheduler. One ticket per due run,
// claimed once; no backlog after downtime; a rule whose run-as user can no
// longer make its ticket pauses itself and says why.

const { RecurringTicket, Ticket, Notification } = models;

let w;
let tina;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${tina.user.id}/overrides`).send({ permissionKey: 'tickets.recurring.manage', granted: true }), 201);
});
afterAll(closeDb);

const daily = {
  frequency: 'daily', interval: 1, timeOfDay: '09:00', timezone: 'America/Chicago', startDate: '2026-01-01',
};
async function rule(fields = {}, agent = tina.agent) {
  const r = expectOk(await agent.post(`${API}/recurring-tickets`).send({
    title: 'Daily check', contactId: w.contact.id, departmentId: w.deptA.id, ...daily, ...fields,
  }), 201).rule;
  return RecurringTicket.findByPk(r.id);
}
const due = (r, at) => r.update({ nextRunAt: new Date(at) });

it('creates one ticket for a due rule and advances nextRunAt', async () => {
  const r = await rule();
  await due(r, '2026-03-02T15:00:00Z');
  const now = new Date('2026-03-02T15:00:30Z');
  expect(await runDueRecurring(now)).toEqual({ created: 1, paused: 0 });
  const t = await Ticket.findOne({ where: { source: 'recurring' } });
  expect(t.title).toBe('Daily check');
  const fresh = await RecurringTicket.findByPk(r.id);
  expect(fresh.nextRunAt.toISOString()).toBe('2026-03-03T15:00:00.000Z');
  expect([fresh.lastTicketId, fresh.lastRunAt.toISOString()]).toEqual([t.id, now.toISOString()]);
  // Nothing more is due.
  expect(await runDueRecurring(now)).toEqual({ created: 0, paused: 0 });
});

it('two concurrent ticks create exactly one ticket', async () => {
  const r = await rule();
  await due(r, '2026-03-02T15:00:00Z');
  const now = new Date('2026-03-02T15:00:30Z');
  const [a, b] = await Promise.all([runDueRecurring(now), runDueRecurring(now)]);
  expect(a.created + b.created).toBe(1);
  expect(await Ticket.count({ where: { source: 'recurring' } })).toBe(1);
});

it('after downtime it skips to the next future run (no backlog)', async () => {
  const r = await rule();
  await due(r, '2026-03-02T15:00:00Z');
  const now = new Date('2026-03-09T12:00:00Z'); // a week of missed runs
  expect(await runDueRecurring(now)).toEqual({ created: 1, paused: 0 });
  const fresh = await RecurringTicket.findByPk(r.id);
  expect(fresh.nextRunAt.toISOString()).toBe(nextRun(fresh, now).toISOString());
  expect(fresh.nextRunAt.toISOString()).toBe('2026-03-09T14:00:00.000Z'); // CDT from Mar 8
  expect(await Ticket.count({ where: { source: 'recurring' } })).toBe(1);
});

it('past endDate the rule deactivates after its last run', async () => {
  const r = await rule({ endDate: '2027-01-10' });
  await r.update({ endDate: '2026-03-02', nextRunAt: new Date('2026-03-02T15:00:00Z') });
  expect(await runDueRecurring(new Date('2026-03-02T15:01:00Z'))).toEqual({ created: 1, paused: 0 });
  const fresh = await RecurringTicket.findByPk(r.id);
  expect([fresh.active, fresh.nextRunAt]).toEqual([false, null]);
});

it('run-as user deactivated → no ticket, paused with lastError, notified', async () => {
  const r = await rule();
  await due(r, '2026-03-02T15:00:00Z');
  await models.User.update({ isActive: false }, { where: { id: tina.user.id } });
  expect(await runDueRecurring(new Date('2026-03-02T15:00:30Z'))).toEqual({ created: 0, paused: 1 });
  expect(await Ticket.count()).toBe(0);
  const fresh = await RecurringTicket.findByPk(r.id);
  expect([fresh.active, fresh.lastError]).toEqual([false, 'The user this rule runs as can no longer create tickets']);
  const note = await Notification.findOne({ where: { userId: tina.user.id, type: 'recurring_paused' } });
  expect(note.message).toBe('Recurring ticket "Daily check" was paused: The user this rule runs as can no longer create tickets');
});

it('run-as user lost the contact company → paused, other rules still run', async () => {
  const acme = await makeCompany(w.admin);
  const acmeContact = await makeContact(w.admin, { companyId: acme.id });
  const lost = await rule({ title: 'Acme check', contactId: acmeContact.id, departmentId: null });
  const fine = await rule({ title: 'Home check' });
  await due(lost, '2026-03-02T15:00:00Z');
  await due(fine, '2026-03-02T15:00:00Z');
  const [{ id: internalId }] = await models.sequelize.query('SELECT id FROM Companies WHERE isInternal = 1', { type: 'SELECT' });
  await setCompanyAccess(w.admin, tina.user.id, { allCompanies: false, companyIds: [internalId] });
  expect(await runDueRecurring(new Date('2026-03-02T15:00:30Z'))).toEqual({ created: 1, paused: 1 });
  expect((await Ticket.findAll()).map((t) => t.title)).toEqual(['Home check']);
  const paused = await RecurringTicket.findByPk(lost.id);
  expect([paused.active, paused.lastError]).toEqual([false, 'Contact not found']);
});

it('an unexpected error pauses the rule with a generic message, not the internal one', async () => {
  const runner = require('../../src/services/recurring/runRule'); // eslint-disable-line global-require
  const spy = jest.spyOn(runner, 'runRule').mockRejectedValueOnce(new Error('ER_LOCK_DEADLOCK: table RecurringTickets secret'));
  const r = await rule();
  await due(r, '2026-03-02T15:00:00Z');
  expect(await runDueRecurring(new Date('2026-03-02T15:00:30Z'))).toEqual({ created: 0, paused: 1 });
  spy.mockRestore();
  const fresh = await RecurringTicket.findByPk(r.id);
  expect(fresh.lastError).toBe('Could not create the ticket; see the server log');
});
