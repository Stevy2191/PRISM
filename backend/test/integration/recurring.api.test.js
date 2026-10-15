jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const { nextRun } = require('../../src/services/recurring/schedule');
const {
  API, expectOk, makeWorld, makeTech, makeTeam, makeContact, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Service desk 5b task 9: the recurring tickets API. Every route needs
// tickets.recurring.manage; a rule is checked against, and runs as, whoever
// last saved it (D17); rules whose contact the viewer can't reach are hidden.

let w;
let tina; // System Technician + tickets.recurring.manage (override)
let acmeContact;
let internalId;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${tina.user.id}/overrides`).send({ permissionKey: 'tickets.recurring.manage', granted: true }), 201);
  const acme = await makeCompany(w.admin);
  acmeContact = await makeContact(w.admin, { companyId: acme.id });
  [{ id: internalId }] = await models.sequelize.query('SELECT id FROM Companies WHERE isInternal = 1', { type: 'SELECT' });
});
afterAll(closeDb);

const schedule = {
  frequency: 'weekly', interval: 1, weekdays: [1], timeOfDay: '09:00', timezone: 'America/Chicago', startDate: '2026-01-05',
};
const body = (fields = {}) => ({
  title: 'Check backups', description: 'Weekly', priority: 'low', type: 'task', contactId: w.contact.id,
  departmentId: w.deptA.id, tasks: ['Look at logs', 'Test a restore'], ...schedule, ...fields,
});
const create = (agent, fields) => agent.post(`${API}/recurring-tickets`).send(body(fields));

it('needs tickets.recurring.manage for every route', async () => {
  const rule = expectOk(await create(w.admin.agent), 201).rule;
  const plain = await makeTech('plain', w.deptA.id);
  const calls = [
    () => plain.agent.get(`${API}/recurring-tickets`),
    () => plain.agent.get(`${API}/recurring-tickets/${rule.id}`),
    () => plain.agent.post(`${API}/recurring-tickets`).send(body()),
    () => plain.agent.patch(`${API}/recurring-tickets/${rule.id}`).send({ title: 'x' }),
    () => plain.agent.delete(`${API}/recurring-tickets/${rule.id}`),
    () => plain.agent.post(`${API}/recurring-tickets/${rule.id}/run`),
    () => plain.agent.post(`${API}/recurring-tickets/preview`).send({ schedule }),
  ];
  for (const call of calls) {
    // eslint-disable-next-line no-await-in-loop
    expect((await call()).status).toBe(403);
  }
});

it('list and get hide rules whose contact company the viewer cannot reach', async () => {
  const mine = expectOk(await create(w.admin.agent), 201).rule;
  const acme = expectOk(await create(w.admin.agent, { contactId: acmeContact.id, departmentId: null }), 201).rule;
  await setCompanyAccess(w.admin, tina.user.id, { allCompanies: false, companyIds: [internalId] });
  const list = expectOk(await tina.agent.get(`${API}/recurring-tickets`)).rules;
  expect(list.map((r) => r.id)).toEqual([mine.id]);
  const hidden = await tina.agent.get(`${API}/recurring-tickets/${acme.id}`);
  const missing = await tina.agent.get(`${API}/recurring-tickets/999999`);
  expect(hidden.status).toBe(404);
  expect(hidden.body).toEqual(missing.body);
  expect((await tina.agent.patch(`${API}/recurring-tickets/${acme.id}`).send({ active: false })).status).toBe(404);
  expect((await tina.agent.post(`${API}/recurring-tickets/${acme.id}/run`)).status).toBe(404);
  expect((await tina.agent.delete(`${API}/recurring-tickets/${acme.id}`)).status).toBe(404);
});

it('save validates contact, department, team and assignee against the saver', async () => {
  await setCompanyAccess(w.admin, tina.user.id, { allCompanies: false, companyIds: [internalId] });
  const outsider = await makeTech('outsider', w.deptA.id);
  await setCompanyAccess(w.admin, outsider.user.id, { allCompanies: false, companyIds: [] });
  const cases = [
    [{ contactId: acmeContact.id, departmentId: null }, 'Contact not found'],
    [{ contactId: 999999 }, 'Contact not found'],
    [{ departmentId: 999999 }, 'Department not found'],
    [{ teamId: 999999 }, 'Team not found'],
    [{ assigneeId: outsider.user.id }, "Assignee can't see tickets for this company"],
    [{ title: '' }, 'Title is required (at most 255 characters)'],
    [{ priority: 'urgent' }, 'Unknown priority'],
    [{ type: 'chore' }, 'Unknown ticket type'],
    [{ tasks: ['ok', ''] }, 'Tasks must be up to 50 titles of at most 255 characters'],
    [{ frequency: 'hourly' }, 'Frequency must be daily, weekly, monthly or yearly'],
  ];
  for (const [fields, message] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const res = await create(tina.agent, fields);
    expect([res.status, res.body.message]).toEqual([400, message]);
  }
  const desk = await makeTeam(w.admin, 'Desk', []);
  expectOk(await create(tina.agent, { teamId: desk.id, assigneeId: tina.user.id }), 201);
});

it('saving sets runsAs to the saver and computes nextRunAt', async () => {
  const rule = expectOk(await create(w.admin.agent), 201).rule;
  expect(rule.runsAs).toEqual({ id: w.admin.user.id, displayName: 'Test admin' });
  const expected = nextRun({ ...schedule, weekdays: [1], dayOfMonth: null, monthOfYear: null, endDate: null }, new Date());
  expect(new Date(rule.nextRunAt).toISOString()).toBe(expected.toISOString());
  expect(rule.active).toBe(true);
  const edited = expectOk(await tina.agent.patch(`${API}/recurring-tickets/${rule.id}`).send({ title: 'Check backups (edited)' })).rule;
  expect(edited.runsAs.id).toBe(tina.user.id);
  expect(edited.title).toBe('Check backups (edited)');
  expect(edited.tasks).toEqual(['Look at logs', 'Test a restore']);
});

it('pause and resume; resume recomputes from now', async () => {
  const rule = expectOk(await create(w.admin.agent), 201).rule;
  await models.RecurringTicket.update({ nextRunAt: new Date('2020-01-01T00:00:00Z'), lastError: 'boom' }, { where: { id: rule.id } });
  const paused = expectOk(await tina.agent.patch(`${API}/recurring-tickets/${rule.id}`).send({ active: false })).rule;
  expect(paused.active).toBe(false);
  expect(paused.runsAs.id).toBe(w.admin.user.id); // pausing isn't a save of the contents
  const resumed = expectOk(await tina.agent.patch(`${API}/recurring-tickets/${rule.id}`).send({ active: true })).rule;
  expect(resumed.active).toBe(true);
  expect(resumed.lastError).toBeNull();
  expect(new Date(resumed.nextRunAt).getTime()).toBeGreaterThan(Date.now());
});

it('run now creates a recurring-source ticket with tasks, created by the system actor, nextRunAt unchanged', async () => {
  const rule = expectOk(await create(tina.agent), 201).rule;
  const ticket = expectOk(await tina.agent.post(`${API}/recurring-tickets/${rule.id}/run`), 201).ticket;
  expect(ticket).toEqual(expect.objectContaining({
    title: 'Check backups', source: 'recurring', priority: 'low', type: 'task', contactId: w.contact.id, createdBy: w.admin.user.id,
  }));
  const tasks = await models.Task.findAll({ where: { ticketId: ticket.id }, order: [['position', 'ASC']] });
  expect(tasks.map((t) => t.title)).toEqual(['Look at logs', 'Test a restore']);
  const fresh = await models.RecurringTicket.findByPk(rule.id);
  expect(fresh.lastTicketId).toBe(ticket.id);
  expect(fresh.nextRunAt.toISOString()).toBe(new Date(rule.nextRunAt).toISOString());
});

it('preview returns five runs and rejects a bad schedule', async () => {
  const runs = expectOk(await tina.agent.post(`${API}/recurring-tickets/preview`).send({ schedule })).runs;
  expect(runs).toHaveLength(5);
  expect(new Date(runs[0]).getTime()).toBeGreaterThan(Date.now());
  expect((await tina.agent.post(`${API}/recurring-tickets/preview`).send({ schedule: { ...schedule, weekdays: [] } })).status).toBe(400);
});
