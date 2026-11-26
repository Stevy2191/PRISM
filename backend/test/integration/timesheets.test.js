const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeTech, makeManager,
} = require('./fixtures');
const timesheets = require('../../src/services/time/timesheets');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { downFrom, upFrom } = require('./moneyMigrations');

// Phase 3, step 3, task 7: weekly timesheets for the internal team. A
// person's week is built from their logged time; they submit it, their
// department's manager approves or sends it back with a note. A submitted
// or approved week is locked to its owner. Works with Customer billing off.

const WEEK = '2026-11-09'; // a Monday
let w;
let tess;
let mia;
let ticket;
const log = (who, entryDate, durationMinutes) => who.agent.post(`${API}/tickets/${ticket.id}/time`).send({ entryDate, durationMinutes });

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  tess = await makeTech('tess', w.deptA.id);
  mia = await makeManager('mia', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Printer jam', contactId: w.contact.id });
  for (const [date, minutes] of [['2026-11-09', 120], ['2026-11-10', 90], ['2026-11-13', 30]]) {
    expectOk(await log(tess, date, minutes), 201); // eslint-disable-line no-await-in-loop
  }
});
afterAll(closeDb);

it('builds the week from the time logged, and submits it', async () => {
  const week = expectOk(await tess.agent.get(`${API}/timesheets/mine?week=2026-11-11`)).timesheet;
  expect(week).toMatchObject({ weekStart: WEEK, status: 'open', totalSeconds: 240 * 60 });
  expect(week.days).toHaveLength(7);
  expect(week.days.map((d) => d.seconds)).toEqual([7200, 5400, 0, 0, 1800, 0, 0]);
  const submitted = expectOk(await tess.agent.post(`${API}/timesheets/mine/submit`).send({ week: WEEK })).timesheet;
  expect(submitted).toMatchObject({ status: 'submitted', totalSeconds: 14400 });
  expect((await tess.agent.post(`${API}/timesheets/mine/submit`).send({ week: WEEK })).status).toBe(409);
});

it('a submitted week is locked to its owner; the next week isn\'t', async () => {
  await tess.agent.post(`${API}/timesheets/mine/submit`).send({ week: WEEK }).expect(200);
  const entry = await models.TimeEntry.findOne({ where: { entryDate: '2026-11-09' } });
  for (const res of [
    await log(tess, '2026-11-12', 15),
    await tess.agent.patch(`${API}/tickets/${ticket.id}/time/${entry.id}`).send({ note: 'x' }),
    await tess.agent.patch(`${API}/tickets/${ticket.id}/time/${entry.id}`).send({ entryDate: '2026-11-16' }),
    await tess.agent.delete(`${API}/tickets/${ticket.id}/time/${entry.id}`),
  ]) {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TIMESHEET_LOCKED');
  }
  expectOk(await log(tess, '2026-11-16', 15), 201);
  // Moving an open week's entry into the locked week is refused too.
  const next = await models.TimeEntry.findOne({ where: { entryDate: '2026-11-16' } });
  expect((await tess.agent.patch(`${API}/tickets/${ticket.id}/time/${next.id}`).send({ entryDate: '2026-11-10' })).status).toBe(409);
});

it('the department\'s manager approves; another department\'s can\'t see it', async () => {
  await tess.agent.post(`${API}/timesheets/mine/submit`).send({ week: WEEK }).expect(200);
  const pending = expectOk(await mia.agent.get(`${API}/timesheets/pending`)).timesheets;
  expect(pending).toEqual([expect.objectContaining({ weekStart: WEEK, status: 'submitted', user: expect.objectContaining({ id: tess.user.id }) })]);
  const max = await makeManager('max', w.deptB.id);
  expect(expectOk(await max.agent.get(`${API}/timesheets/pending`)).timesheets).toEqual([]);
  expect((await max.agent.post(`${API}/timesheets/${pending[0].id}/approve`).send({})).status).toBe(404);
  expect((await tess.agent.post(`${API}/timesheets/${pending[0].id}/approve`).send({})).status).toBe(403);
  const approved = expectOk(await mia.agent.post(`${API}/timesheets/${pending[0].id}/approve`).send({})).timesheet;
  expect(approved).toMatchObject({ status: 'approved', decidedById: mia.user.id });
  expect((await log(tess, '2026-11-12', 15)).status).toBe(409);
  // The admin sees everyone's.
  expect((await w.admin.agent.get(`${API}/timesheets/pending?status=approved`)).body.timesheets).toHaveLength(1);
});

it('sending it back needs a note, and opens the week again', async () => {
  await tess.agent.post(`${API}/timesheets/mine/submit`).send({ week: WEEK }).expect(200);
  const [sheet] = expectOk(await mia.agent.get(`${API}/timesheets/pending`)).timesheets;
  expect((await mia.agent.post(`${API}/timesheets/${sheet.id}/reject`).send({})).status).toBe(400);
  const back = expectOk(await mia.agent.post(`${API}/timesheets/${sheet.id}/reject`).send({ note: 'Friday is missing' })).timesheet;
  expect(back).toMatchObject({ status: 'rejected', note: 'Friday is missing' });
  expectOk(await log(tess, '2026-11-12', 15), 201);
  expect(expectOk(await tess.agent.post(`${API}/timesheets/mine/submit`).send({ week: WEEK })).timesheet.status).toBe('submitted');
  expect(await models.Notification.count({ where: { userId: tess.user.id, type: 'timesheet_rejected' } })).toBe(1);
  expect(await models.Notification.count({ where: { userId: mia.user.id, type: 'timesheet_submitted' } })).toBe(2);
});

it('works with Customer billing off', async () => {
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expectOk(await tess.agent.get(`${API}/timesheets/mine?week=${WEEK}`));
});

it('reminds people with time logged and the week still open, once', async () => {
  const nextMonday = '2026-11-16';
  expect((await timesheets.remindOpenWeeks({ today: nextMonday })).reminded).toEqual([tess.user.id]);
  expect((await timesheets.remindOpenWeeks({ today: nextMonday })).reminded).toEqual([]);
  expect(await models.Notification.count({ where: { userId: tess.user.id, type: 'timesheet_due' } })).toBe(1);
});

it('migration 118 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000118');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('Timesheets');
  await upFrom('20260101000118');
  expect((await qi.describeTable('Timesheets')).weekStart).toBeDefined();
});
