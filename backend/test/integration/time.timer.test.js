const { resetData, closeDb, ROLE } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeUser, makeContractor, makeTicket, makeProject, makeTask,
  setSettings, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S2: POST /timer/start checks access to the ticket', () => {
  it('refuses a ticket the user cannot see, and starts nothing', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const other = await makeTicket(w.admin.agent, { title: 'B only', contactId: w.contact.id, departmentId: w.deptB.id });
    const res = await staff.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: other.id });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have access to this ticket', code: 'FORBIDDEN' });
    expect(expectOk(await staff.agent.get(`${API}/timer`)).timer).toBeNull();
  });

  it('still starts on a ticket the user can see', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { title: 'A', contactId: w.contact.id, departmentId: w.deptA.id });
    const res = await staff.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: mine.id });
    expect([res.status, res.body.timer.id]).toEqual([201, mine.id]);
  });
});

describe('the timer', () => {
  let T;
  let T2;
  let P;
  beforeEach(async () => {
    T = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
    T2 = await makeTicket(w.admin.agent, { title: 'Scanner', contactId: w.contact.id, departmentId: w.deptA.id });
    P = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  });
  const start = (u, body) => u.agent.post(`${API}/timer/start`).send(body);
  const onTicket = (u, t, extra = {}) => start(u, { type: 'ticket', id: t.id, ...extra });
  const stop = async (u, body = {}) => expectOk(await u.agent.post(`${API}/timer/stop`).send(body));
  const current = async (u) => expectOk(await u.agent.get(`${API}/timer`)).timer;

  it('needs time.log', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    expect((await ro.agent.get(`${API}/timer`)).status).toBe(403);
  });

  it('validates start', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const otherTask = expectOk(await w.admin.agent.post(`${API}/tickets/${T2.id}/tasks`).send({ title: 'x' }), 201).task;
    const cases = [
      [{ type: 'asset', id: T.id }, 400, 'Invalid timer type', 'VALIDATION_ERROR'],
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

  it('starts a timer, on a ticket, a project or a task', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const res = await onTicket(tech, T, { label: 'Working' });
    const timer = { type: 'ticket', id: T.id, taskId: null, label: 'Working', startedAt: '2026-03-11T15:00:00.000Z' };
    expect([res.status, res.body]).toEqual([201, { timer, logged: null }]);
    expect(await current(tech)).toEqual(timer);
    const task = await makeTask(w.admin.agent, P.id, { title: 'Rack' });
    const onTask = expectOk(await start(tech, { type: 'project', id: P.id, taskId: task.id }), 201);
    expect(onTask.timer).toEqual(expect.objectContaining({ type: 'project', id: P.id, taskId: task.id }));
  });

  it('starting the same target again changes nothing', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    advanceClock(60 * 1000);
    const res = await onTicket(tech, T);
    expect([res.status, res.body.timer.startedAt, res.body.logged]).toEqual([200, '2026-03-11T15:00:00.000Z', null]);
  });

  it('starting another target logs the first', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    advanceClock(600 * 1000);
    const res = await onTicket(tech, T2);
    expect(res.status).toBe(201);
    expect(res.body.logged).toEqual(expect.objectContaining({
      ticketId: T.id, durationSeconds: 600, note: 'Timer', startTime: '2026-03-11T15:00:00.000Z', endTime: '2026-03-11T15:10:00.000Z',
    }));
  });

  it('stopping with no timer', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expect(await stop(tech)).toEqual({ timer: null, entry: null });
  });

  it('Q5: stopping logs a span, by the person, on the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z'); // 22:30 on the 9th in Chicago
    const tech = await makeTech('tech', w.deptA.id);
    expectOk(await onTicket(tech, T, { label: 'Working' }), 201);
    advanceClock(125 * 1000);
    const { entry, timer } = await stop(tech, { note: 'Done' });
    expect(timer).toBeNull();
    expect(entry).toEqual(expect.objectContaining({
      ticketId: T.id, userId: tech.user.id, loggedById: tech.user.id, durationSeconds: 125, note: 'Done',
      startTime: '2026-03-10T03:30:00.000Z', endTime: '2026-03-10T03:32:05.000Z', entryDate: '2026-03-09', laborCost: null,
    }));
    expect(entry.workType.name).toBe('Remote support');
    expect(await current(tech)).toBeNull();
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).totalSeconds).toBe(125);
  });

  it('a project timer on a task logs project time on that task', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const task = await makeTask(w.admin.agent, P.id, { title: 'Rack' });
    expectOk(await start(tech, { type: 'project', id: P.id, taskId: task.id }), 201);
    advanceClock(1800 * 1000);
    const { entry } = await stop(tech);
    expect([entry.projectId, entry.taskId, entry.durationSeconds, entry.workType.name]).toEqual([P.id, task.id, 1800, 'Project work']);
    const { activity } = expectOk(await tech.agent.get(`${API}/projects/${P.id}/activity`));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['time_logged', { minutes: 30 }]);
  });

  it('under a second still logs one second; the activity says 1m', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    expect((await stop(tech)).entry.durationSeconds).toBe(1);
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${T.id}/activity`));
    expect(activity.map((a) => [a.action, a.toValue])).toContainEqual(['time_logged', '1m']);
  });

  it('charges a contractor for the elapsed time', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await onTicket(ctr, T);
    advanceClock(1800 * 1000);
    expect((await stop(ctr)).entry.laborCost).toBe(30);
  });

  it('cancel discards without logging', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    expect(expectOk(await tech.agent.delete(`${API}/timer`))).toEqual({ ok: true, timer: null });
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).total).toBe(0);
  });

  it('each user has their own timer', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await onTicket(tech, T);
    advanceClock(60 * 1000);
    await onTicket(ctr, T);
    expect((await current(tech)).startedAt).toBe('2026-03-11T15:00:00.000Z');
    expect((await current(ctr)).startedAt).toBe('2026-03-11T15:01:00.000Z');
  });

  it('Q34: a timer whose ticket was deleted is discarded, with a reason, by stop or by a new start', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expectOk(await onTicket(tech, T2), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${T2.id}`));
    expect(await stop(tech)).toEqual({
      timer: null, entry: null, discarded: true,
      message: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
    });
    expectOk(await onTicket(tech, T), 201); // a fresh start works after the discard
    const T3 = await makeTicket(w.admin.agent, { title: 'Gone soon', contactId: w.contact.id, departmentId: w.deptA.id });
    expectOk(await onTicket(tech, T3), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${T3.id}`));
    const replaced = expectOk(await onTicket(tech, T), 201);
    expect(replaced.logged).toBeNull();
    expect((await current(tech)).id).toBe(T.id);
  });

  it('a timer on something the user can no longer open is discarded, with a reason', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await onTicket(staff, T), 201);
    expectOk(await w.admin.agent.patch(`${API}/tickets/${T.id}`).send({ departmentId: w.deptB.id }));
    expect(await stop(staff)).toEqual({
      timer: null, entry: null, discarded: true,
      message: 'You no longer have access to what this timer was running on, so its time was discarded.',
    });
  });
});
