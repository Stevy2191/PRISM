const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeContractor, makeTicket,
  freezeClock, advanceClock, unfreezeClock,
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
    // Department Staff holds projects.log_time (so the route lets them in)
    // but sees only department A's tickets.
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
    expect(res.status).toBe(201);
    expect(res.body.timer.id).toBe(mine.id);
  });
});

describe('the timer', () => {
  let T;
  let T2;
  beforeEach(async () => {
    T = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
    T2 = await makeTicket(w.admin.agent, { title: 'Scanner', contactId: w.contact.id, departmentId: w.deptA.id });
  });
  const start = (u, t, label) => u.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: t.id, label });
  const stop = async (u, body = {}) => expectOk(await u.agent.post(`${API}/timer/stop`).send(body));
  const current = async (u) => expectOk(await u.agent.get(`${API}/timer`)).timer;

  it('no timer to begin with', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expect(expectOk(await tech.agent.get(`${API}/timer`))).toEqual({ timer: null });
  });

  it('validates start', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const cases = [
      [{ type: 'project', id: T.id }, 400, { error: true, message: 'Invalid timer type', code: 'VALIDATION_ERROR' }],
      [{ type: 'ticket' }, 400, { error: true, message: 'A target id is required', code: 'VALIDATION_ERROR' }],
      [{ type: 'ticket', id: 99999 }, 404, { error: true, message: 'Ticket not found', code: 'NOT_FOUND' }],
    ];
    for (const [body, status, error] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(`${API}/timer/start`).send(body);
      expect(res.status).toBe(status);
      expect(res.body).toEqual(error);
    }
  });

  it('starts a timer', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const res = await start(tech, T, 'Working');
    expect(res.status).toBe(201);
    const timer = { type: 'ticket', id: T.id, label: 'Working', startedAt: '2026-03-11T15:00:00.000Z' };
    expect(res.body).toEqual({ timer, logged: null });
    expect(await current(tech)).toEqual(timer);
  });

  it('starting the same ticket again changes nothing', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await start(tech, T);
    advanceClock(60 * 1000);
    const res = await start(tech, T);
    expect(res.status).toBe(200);
    expect(res.body.timer.startedAt).toBe('2026-03-11T15:00:00.000Z');
    expect(res.body.logged).toBeNull();
  });

  it('starting another ticket logs the first', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await start(tech, T);
    advanceClock(600 * 1000);
    const res = await start(tech, T2);
    expect(res.status).toBe(201);
    expect(res.body.timer).toEqual(expect.objectContaining({ id: T2.id, startedAt: '2026-03-11T15:10:00.000Z' }));
    expect(res.body.logged).toEqual(expect.objectContaining({
      ticketId: T.id, minutes: 10, durationSeconds: 600, note: 'Timer', loggedAt: '2026-03-11T15:00:00.000Z',
    }));
  });

  it('stopping with no timer', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expect(await stop(tech)).toEqual({ timer: null, entry: null });
  });

  it('logs the elapsed time against the start', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    expectOk(await start(tech, T, 'Working'), 201);
    advanceClock(125 * 1000);
    const { entry, timer } = await stop(tech, { note: 'Done' });
    expect(timer).toBeNull();
    expect(entry).toEqual(expect.objectContaining({
      ticketId: T.id, userId: tech.user.id, minutes: 2, durationSeconds: 125, note: 'Done',
      loggedAt: '2026-03-11T15:00:00.000Z', laborCost: null,
    }));
    expect(await current(tech)).toBeNull();
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).totalMinutes).toBe(2);
  });

  it('under a minute still logs one minute', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await start(tech, T);
    advanceClock(20 * 1000);
    expect((await stop(tech)).entry).toEqual(expect.objectContaining({ minutes: 1, durationSeconds: 20, note: 'Timer' }));
  });

  it('charges a contractor for the elapsed time', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await start(ctr, T);
    advanceClock(1800 * 1000);
    expect((await stop(ctr)).entry.laborCost).toBe(30);
  });

  // Likely correct: timer time has the same shape as manual time (span, logger,
  // the work date). Expected to change in sub-project 3.
  it('[quirk] Q5: timer time has no span or logger, and its entryDate is the stop\'s UTC date', async () => {
    freezeClock('2026-03-09T23:50:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await start(tech, T);
    advanceClock(1800 * 1000);
    await stop(tech);
    // Read back through the list: the stop response is the raw create result,
    // which leaves unset columns out rather than returning them as null.
    const [entry] = expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).entries;
    expect(entry).toEqual(expect.objectContaining({
      startTime: null, endTime: null, loggedById: null, loggedBy: null,
      loggedAt: '2026-03-09T23:50:00.000Z', entryDate: '2026-03-10',
    }));
  });

  it('cancel discards without logging', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    await start(tech, T);
    expect(expectOk(await tech.agent.delete(`${API}/timer`))).toEqual({ ok: true, timer: null });
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).total).toBe(0);
  });

  it('stopping writes the ticket\'s time_logged entry', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await start(tech, T);
    advanceClock(125 * 1000);
    await stop(tech);
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${T.id}/activity`));
    expect(activity.map((a) => [a.action, a.fromValue, a.toValue])).toContainEqual(['time_logged', null, '2m']);
  });

  it('each user has their own timer', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await start(tech, T);
    advanceClock(60 * 1000);
    await start(ctr, T);
    expect((await current(tech)).startedAt).toBe('2026-03-11T15:00:00.000Z');
    expect((await current(ctr)).startedAt).toBe('2026-03-11T15:01:00.000Z');
  });

  // Likely correct: stopping a timer whose ticket is gone discards it (or logs
  // nothing) instead of failing. Expected to change in sub-project 3.
  it('[quirk] Q34: a timer on a deleted ticket can\'t be stopped or replaced', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expectOk(await start(tech, T2), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${T2.id}`));
    const stopped = await tech.agent.post(`${API}/timer/stop`).send({});
    expect(stopped.status).toBe(400);
    expect(stopped.body.code).toBe('FK_CONSTRAINT');
    const replaced = await start(tech, T);
    expect(replaced.status).toBe(400);
    expect(replaced.body.code).toBe('FK_CONSTRAINT');
    expect((await current(tech)).id).toBe(T2.id);
    expectOk(await tech.agent.delete(`${API}/timer`));
    expect(await current(tech)).toBeNull();
  });
});
