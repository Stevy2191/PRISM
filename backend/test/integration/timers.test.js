const { resetData, closeDb, ROLE, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeUser, makeContractor, makeTicket, makeProject, makeTask,
  setSettings, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// A user's timers (user decision 2026-10-12): one per ticket or project.
// Timers on different items count at the same time; on the same item,
// another task's timer logs the current one first. A timer stops counting at
// the longest-entry limit (12 hours unless set). Pause and resume from plan 3c.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

const HOUR = 3600;
const start = (u, body) => u.agent.post(`${API}/timer/start`).send(body);
const onTicket = (u, t, extra = {}) => start(u, { type: 'ticket', id: t.id, ...extra });
const act = (u, timer, verb, body = {}) => u.agent.post(`${API}/timer/${timer.timerId}/${verb}`).send(body);
const stop = async (u, timer, body = {}) => expectOk(await act(u, timer, 'stop', body));
const timers = async (u) => expectOk(await u.agent.get(`${API}/timer`)).timers;
const err = (res) => [res.status, res.body.code, res.body.message];

describe('S2: POST /timer/start checks access to the ticket', () => {
  it('refuses a ticket the user cannot see, and starts nothing', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const other = await makeTicket(w.admin.agent, { title: 'B only', contactId: w.contact.id, departmentId: w.deptB.id });
    const res = await onTicket(staff, other);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have access to this ticket', code: 'FORBIDDEN' });
    expect(await timers(staff)).toEqual([]);
  });

  it('still starts on a ticket the user can see', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { title: 'A', contactId: w.contact.id, departmentId: w.deptA.id });
    const res = await onTicket(staff, mine);
    expect([res.status, res.body.timer.id]).toEqual([201, mine.id]);
  });
});

describe('timers', () => {
  let T;
  let T2;
  let P;
  let tech;
  beforeEach(async () => {
    T = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
    T2 = await makeTicket(w.admin.agent, { title: 'Scanner', contactId: w.contact.id, departmentId: w.deptA.id });
    P = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
    tech = await makeTech('tech', w.deptA.id);
  });

  it('need time.log', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    expect((await ro.agent.get(`${API}/timer`)).status).toBe(403);
  });

  it('validate start', async () => {
    const otherTask = expectOk(await w.admin.agent.post(`${API}/tickets/${T2.id}/tasks`).send({ title: 'x' }), 201).task;
    const cases = [
      [{ type: 'asset', id: T.id }, 400, 'Invalid timer type', 'VALIDATION_ERROR'],
      [{ type: '__proto__', id: T.id }, 400, 'Invalid timer type', 'VALIDATION_ERROR'],
      [{ type: 'constructor', id: T.id }, 400, 'Invalid timer type', 'VALIDATION_ERROR'],
      [{ type: 'ticket' }, 400, 'A target id is required', 'VALIDATION_ERROR'],
      [{ type: 'ticket', id: '1abc' }, 400, 'A target id is required', 'VALIDATION_ERROR'],
      [{ type: 'ticket', id: 99999 }, 404, 'Ticket not found', 'NOT_FOUND'],
      [{ type: 'project', id: 99999 }, 404, 'Project not found', 'NOT_FOUND'],
      [{ type: 'ticket', id: T.id, taskId: otherTask.id }, 400, 'Task does not belong to this ticket', 'VALIDATION_ERROR'],
    ];
    for (const [body, status, message, code] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await start(tech, body);
      expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
    }
  });

  it('start on a ticket, a project or a task, and list newest first with the limit', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const res = await onTicket(tech, T, { label: 'Working' });
    const timer = {
      timerId: res.body.timer.timerId, type: 'ticket', id: T.id, taskId: null, label: 'Working', startedAt: '2026-03-11T15:00:00.000Z',
      state: 'running', elapsedSeconds: 0, atLimit: false, limitSeconds: 12 * HOUR,
    };
    expect([res.status, res.body]).toEqual([201, { timer, logged: null, started: true }]);
    advanceClock(1000);
    const task = await makeTask(w.admin.agent, P.id, { title: 'Rack' });
    const onTask = expectOk(await start(tech, { type: 'project', id: P.id, taskId: task.id }), 201).timer;
    expect(onTask).toEqual(expect.objectContaining({ type: 'project', id: P.id, taskId: task.id }));
    const listed = expectOk(await tech.agent.get(`${API}/timer`));
    expect([listed.limitSeconds, listed.timers.map((t) => t.timerId)]).toEqual([12 * HOUR, [onTask.timerId, timer.timerId]]);
  });

  it('starting the same target again changes nothing', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    await onTicket(tech, T);
    advanceClock(60 * 1000);
    const res = await onTicket(tech, T);
    expect([res.status, res.body.timer.startedAt, res.body.logged, res.body.started]).toEqual([200, '2026-03-11T15:00:00.000Z', null, false]);
  });

  it('timers on different items count at the same time; starting one logs nothing', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const a = expectOk(await onTicket(tech, T), 201).timer;
    advanceClock(600 * 1000);
    const b = expectOk(await onTicket(tech, T2), 201);
    expect(b.logged).toBeNull();
    advanceClock(300 * 1000);
    const both = Object.fromEntries((await timers(tech)).map((t) => [t.id, [t.state, t.elapsedSeconds]]));
    expect(both).toEqual({ [T.id]: ['running', 900], [T2.id]: ['running', 300] });
    expect((await stop(tech, a)).entry.durationSeconds).toBe(900);
    expect((await timers(tech)).map((t) => t.id)).toEqual([T2.id]);
  });

  it('on the same item, another task\'s timer logs the current one first', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const task = expectOk(await w.admin.agent.post(`${API}/tickets/${T.id}/tasks`).send({ title: 'Toner' }), 201).task;
    await onTicket(tech, T);
    await onTicket(tech, T2);
    advanceClock(600 * 1000);
    const res = expectOk(await onTicket(tech, T, { taskId: task.id }), 201);
    expect(res.logged).toEqual(expect.objectContaining({
      ticketId: T.id, taskId: null, durationSeconds: 600, note: 'Timer', startTime: '2026-03-11T15:00:00.000Z', endTime: '2026-03-11T15:10:00.000Z',
    }));
    expect((await timers(tech)).map((t) => [t.id, t.taskId])).toEqual([[T.id, task.id], [T2.id, null]]);
  });

  it('automatic mode (onlyIfNone) starts on a new item while others run, and leaves an item\'s own timer alone', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const a = expectOk(await onTicket(tech, T), 201).timer;
    expectOk(await act(tech, a, 'pause'));
    // Moving on to another ticket starts its timer (it used to need no timer anywhere).
    expect(expectOk(await onTicket(tech, T2, { onlyIfNone: true }), 201).started).toBe(true);
    const again = expectOk(await onTicket(tech, T, { onlyIfNone: true }));
    expect([again.started, again.timer.state]).toEqual([false, 'paused']);
  });

  it('Q5: stopping logs a span, by the person, on the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z'); // 22:30 on the 9th in Chicago
    const t = expectOk(await onTicket(tech, T, { label: 'Working' }), 201).timer;
    advanceClock(125 * 1000);
    const { entry } = await stop(tech, t, { note: 'Done' });
    expect(entry).toEqual(expect.objectContaining({
      ticketId: T.id, userId: tech.user.id, loggedById: tech.user.id, durationSeconds: 125, note: 'Done',
      startTime: '2026-03-10T03:30:00.000Z', endTime: '2026-03-10T03:32:05.000Z', entryDate: '2026-03-09', laborCost: null,
    }));
    expect(entry.workType.name).toBe('Remote support');
    expect(await timers(tech)).toEqual([]);
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).totalSeconds).toBe(125);
  });

  it('a stopped timer can be logged as the Log time form\'s entry', async () => {
    const t = expectOk(await onTicket(tech, T), 201).timer;
    const { entry } = await stop(tech, t, { entry: { durationMinutes: 45, note: 'Corrected' } });
    expect([entry.durationSeconds, entry.note]).toEqual([2700, 'Corrected']);
    expect(await timers(tech)).toEqual([]);
  });

  it('a project timer on a task logs project time on that task', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const task = await makeTask(w.admin.agent, P.id, { title: 'Rack' });
    const t = expectOk(await start(tech, { type: 'project', id: P.id, taskId: task.id }), 201).timer;
    advanceClock(1800 * 1000);
    const { entry } = await stop(tech, t);
    expect([entry.projectId, entry.taskId, entry.durationSeconds, entry.workType.name]).toEqual([P.id, task.id, 1800, 'Project work']);
    const { activity } = expectOk(await tech.agent.get(`${API}/projects/${P.id}/activity`));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['time_logged', { minutes: 30 }]);
  });

  it('under a second still logs one second; the activity says 1m', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const t = expectOk(await onTicket(tech, T), 201).timer;
    expect((await stop(tech, t)).entry.durationSeconds).toBe(1);
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${T.id}/activity`));
    expect(activity.map((a) => [a.action, a.toValue])).toContainEqual(['time_logged', '1m']);
  });

  it('charges a contractor for the elapsed time', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    const t = expectOk(await onTicket(ctr, T), 201).timer;
    advanceClock(1800 * 1000);
    expect((await stop(ctr, t)).entry.laborCost).toBe(30);
  });

  it('discarding (DELETE, or stop with discard) logs nothing', async () => {
    const a = expectOk(await onTicket(tech, T), 201).timer;
    const b = expectOk(await onTicket(tech, T2), 201).timer;
    expect(expectOk(await tech.agent.delete(`${API}/timer/${a.timerId}`))).toEqual({ ok: true });
    expect(await stop(tech, b, { discard: true })).toEqual({ entry: null, discarded: true });
    expect(await models.TimeEntry.count()).toBe(0);
    expect(await timers(tech)).toEqual([]);
  });

  it('a timer already logged elsewhere, or someone else\'s, is a 409 and nothing happens', async () => {
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    const theirs = expectOk(await onTicket(ctr, T), 201).timer;
    for (const verb of ['stop', 'pause', 'resume']) {
      // eslint-disable-next-line no-await-in-loop
      expect(err(await act(tech, theirs, verb))).toEqual([409, 'TIMER_CHANGED', 'This timer was already logged or replaced']);
    }
    expect((await tech.agent.delete(`${API}/timer/${theirs.timerId}`)).status).toBe(409);
    expect((await timers(ctr)).map((t) => t.state)).toEqual(['running']);
    const mine = expectOk(await onTicket(tech, T), 201).timer;
    await stop(tech, mine);
    expect(err(await act(tech, mine, 'stop'))).toEqual([409, 'TIMER_CHANGED', 'This timer was already logged or replaced']);
    expect(await models.TimeEntry.count()).toBe(1);
  });

  it('each user has their own timers', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await onTicket(tech, T);
    advanceClock(60 * 1000);
    await onTicket(ctr, T);
    expect((await timers(tech))[0].startedAt).toBe('2026-03-11T15:00:00.000Z');
    expect((await timers(ctr))[0].startedAt).toBe('2026-03-11T15:01:00.000Z');
  });

  it('at most 20 timers each', async () => {
    const tickets = [];
    for (let i = 0; i < 21; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      tickets.push(await makeTicket(w.admin.agent, { title: `T${i}`, contactId: w.contact.id, departmentId: w.deptA.id }));
    }
    for (const t of tickets.slice(0, 20)) expectOk(await onTicket(tech, t), 201); // eslint-disable-line no-await-in-loop
    expect(err(await onTicket(tech, tickets[20]))).toEqual([400, 'TOO_MANY_TIMERS', 'You can have at most 20 timers: stop one first']);
    // Switching a task on an item already timed isn't a new timer.
    expect((await onTicket(tech, tickets[0])).status).toBe(200);
  });

  it('Q34: a timer whose ticket was deleted is discarded, with a reason', async () => {
    const t = expectOk(await onTicket(tech, T2), 201).timer;
    expectOk(await w.admin.agent.delete(`${API}/tickets/${T2.id}`));
    expect(await stop(tech, t)).toEqual({
      entry: null, discarded: true,
      message: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
    });
  });

  it('deleting a project stops the timers running on it (user decision 2026-10-11)', async () => {
    const p = await makeProject(w.admin.agent, { name: 'Going away', ownerDepartmentId: w.deptA.id });
    expectOk(await start(tech, { type: 'project', id: p.id }), 201);
    expectOk(await w.admin.agent.delete(`${API}/projects/${p.id}`));
    expect(await timers(tech)).toEqual([]);
    const audit = await models.AuditLog.findOne({ where: { action: 'project.delete', entityId: p.id } });
    expect(audit.meta.timers).toBe(1);
  });

  it('a timer on something the user can no longer open is discarded, with a reason', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const t = expectOk(await onTicket(staff, T), 201).timer;
    expectOk(await w.admin.agent.patch(`${API}/tickets/${T.id}`).send({ departmentId: w.deptB.id }));
    expect(await stop(staff, t)).toEqual({
      entry: null, discarded: true,
      message: 'You no longer have access to what this timer was running on, so its time was discarded.',
    });
  });
});

describe('pause and resume', () => {
  let tech;
  let ticket;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  });

  it('count only running stretches, and stopping a paused timer logs what it showed', async () => {
    freezeClock('2026-03-10T15:00:00Z');
    const t = expectOk(await onTicket(tech, ticket), 201).timer;
    advanceClock(10 * 60 * 1000);
    expect(expectOk(await act(tech, t, 'pause')).timer).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 600 }));
    advanceClock(3 * HOUR * 1000); // three hours paused
    expect((await timers(tech))[0]).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 600 }));
    expectOk(await act(tech, t, 'resume'));
    advanceClock(5 * 60 * 1000);
    expect((await timers(tech))[0].elapsedSeconds).toBe(900);
    const { entry } = await stop(tech, t);
    expect(entry.durationSeconds).toBe(900);
    expect(new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()).toBe(900 * 1000);
  });

  it('are idempotent', async () => {
    const t = expectOk(await onTicket(tech, ticket), 201).timer;
    expectOk(await act(tech, t, 'pause'));
    expect(expectOk(await act(tech, t, 'pause')).timer.state).toBe('paused');
    expectOk(await act(tech, t, 'resume'));
    expect(expectOk(await act(tech, t, 'resume')).timer.state).toBe('running');
  });

  it('pausing one timer leaves the others running', async () => {
    const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id, departmentId: w.deptA.id });
    const a = expectOk(await onTicket(tech, ticket), 201).timer;
    expectOk(await onTicket(tech, other), 201);
    expectOk(await act(tech, a, 'pause'));
    expect(Object.fromEntries((await timers(tech)).map((t) => [t.id, t.state]))).toEqual({ [ticket.id]: 'paused', [other.id]: 'running' });
  });

  it('switching task on the same item while paused logs the paused time', async () => {
    freezeClock('2026-03-10T15:00:00Z');
    const task = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'x' }), 201).task;
    const t = expectOk(await onTicket(tech, ticket), 201).timer;
    advanceClock(20 * 60 * 1000);
    expectOk(await act(tech, t, 'pause'));
    advanceClock(HOUR * 1000);
    const { logged } = expectOk(await onTicket(tech, ticket, { taskId: task.id }), 201);
    expect(logged.durationSeconds).toBe(1200);
  });
});

describe('the longest entry (user decision 2026-10-12)', () => {
  let tech;
  let ticket;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  });
  const logTime = (minutes) => tech.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: minutes });

  it('a forgotten timer stops counting at 12 hours, pauses there, and can\'t resume; stopping logs 12 hours', async () => {
    const t = expectOk(await onTicket(tech, ticket), 201).timer;
    // Started a weekend ago (moving the clock instead would end the session).
    const ago = new Date(Date.now() - 60 * HOUR * 1000);
    await models.ActiveTimer.update({ startedAt: ago, runningSince: ago }, { where: { id: t.timerId } });
    expect((await timers(tech))[0]).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 12 * HOUR, atLimit: true }));
    expect(err(await act(tech, t, 'resume'))).toEqual([400, 'TIMER_AT_LIMIT', 'This timer reached the 12-hour limit: stop it and log the time']);
    expect(expectOk(await onTicket(tech, ticket)).timer.state).toBe('paused'); // start doesn't resume it either
    expect((await stop(tech, t)).entry.durationSeconds).toBe(12 * HOUR);
  });

  it('entries longer than the limit are refused; an older long entry keeps its time until its time is edited', async () => {
    expectOk(await logTime(12 * 60), 201);
    expect(err(await logTime(12 * 60 + 1))).toEqual([400, 'VALIDATION_ERROR', 'A time entry can\'t be longer than 12 hours']);
    const old = await models.TimeEntry.create({
      ticketId: ticket.id, userId: tech.user.id, loggedById: tech.user.id, entryDate: '2026-01-05', durationSeconds: 20 * HOUR,
      workTypeId: (await models.WorkType.findOne()).id, billable: true,
    });
    const url = `${API}/tickets/${ticket.id}/time/${old.id}`;
    expect(expectOk(await tech.agent.patch(url).send({ note: 'checked' })).entry.durationSeconds).toBe(20 * HOUR);
    expect(err(await tech.agent.patch(url).send({ durationMinutes: 13 * 60 })))
      .toEqual([400, 'VALIDATION_ERROR', 'A time entry can\'t be longer than 12 hours']);
  });

  it('an administrator sets it from 1 to 24 hours', async () => {
    for (const bad of ['0', '25', '1.5', 'x']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await w.admin.agent.patch(`${API}/settings`).send({ 'timeTracking.maxEntryHours': bad });
      expect(err(res)).toEqual([400, 'VALIDATION_ERROR', 'The longest time entry must be a whole number of hours from 1 to 24']);
    }
    await setSettings(w.admin, { 'timeTracking.maxEntryHours': '2' });
    expect(err(await logTime(121))).toEqual([400, 'VALIDATION_ERROR', 'A time entry can\'t be longer than 2 hours']);
    const t = expectOk(await onTicket(tech, ticket), 201).timer;
    const ago = new Date(Date.now() - 3 * HOUR * 1000);
    await models.ActiveTimer.update({ startedAt: ago, runningSince: ago }, { where: { id: t.timerId } });
    expect((await timers(tech))[0]).toEqual(expect.objectContaining({ elapsedSeconds: 2 * HOUR, atLimit: true, limitSeconds: 2 * HOUR }));
  });
});

describe('reminder preferences', () => {
  it('default to 2 hours then hourly; each user sets theirs, 0 turns them off', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const me = async () => expectOk(await tech.agent.get(`${API}/auth/me`)).user;
    expect([(await me()).timerReminderMinutes, (await me()).timerReminderRepeatMinutes]).toEqual([120, 60]);
    const prefs = (body) => tech.agent.patch(`${API}/users/${tech.user.id}/preferences`).send(body);
    expectOk(await prefs({ timerReminderMinutes: 0, timerReminderRepeatMinutes: 30 }));
    expect([(await me()).timerReminderMinutes, (await me()).timerReminderRepeatMinutes]).toEqual([0, 30]);
    expect(err(await prefs({ timerReminderMinutes: -1 })))
      .toEqual([400, 'VALIDATION_ERROR', 'timerReminderMinutes must be a whole number of minutes from 0 to 1440']);
    expect(err(await prefs({ timerReminderRepeatMinutes: 5 })))
      .toEqual([400, 'VALIDATION_ERROR', 'timerReminderRepeatMinutes must be a whole number of minutes from 15 to 1440']);
  });
});
