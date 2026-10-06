const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeTicket, setSettings,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Ticket time on the one ledger (sub-project 3): what is stored, how it is
// costed, edited and deleted. Who may log for whom: time.permissions.test.js.

let w;
let tech;
let ctr;
let ticket;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 75 });
  ticket = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const timeUrl = (t = ticket) => `${API}/tickets/${t.id}/time`;
const log = async (agent, body, t) => expectOk(await agent.post(timeUrl(t)).send(body), 201).entry;
const patch = (agent, e, body) => agent.patch(`${timeUrl()}/${e.id}`).send(body);
const span = (startTime, endTime) => ({ startTime, endTime });
const today = () => new Date().toISOString().slice(0, 10);
const err = (message) => ({ error: true, message, code: 'VALIDATION_ERROR' });

describe('logging a duration', () => {
  it('logs durationMinutes', async () => {
    const e = await log(tech.agent, { durationMinutes: 45, note: 'Fuser' });
    expect(e).toEqual(expect.objectContaining({
      ticketId: ticket.id, projectId: null, taskId: null, userId: tech.user.id, loggedById: tech.user.id,
      durationSeconds: 2700, startTime: null, endTime: null, note: 'Fuser', entryDate: today(), laborCost: null, billable: true,
    }));
    expect([e.user.username, e.loggedBy.username, e.workType.name]).toEqual(['tech', 'tech', 'Remote support']);
  });

  it('accepts a whole number sent as a string', async () => {
    expect((await log(tech.agent, { durationMinutes: '30' })).durationSeconds).toBe(1800);
  });

  it('refuses anything but a positive whole number', async () => {
    for (const durationMinutes of [0, -5, 'abc', 1.9, true, null, '']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(timeUrl()).send({ durationMinutes });
      expect(res.body).toEqual(err('durationMinutes must be a positive whole number'));
    }
  });

  it('needs a duration or a span; the old minutes field is not read', async () => {
    for (const body of [{}, { minutes: 30 }]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send(body)).body).toEqual(err('Send durationMinutes, or startTime and endTime'));
    }
  });
});

describe('logging a span', () => {
  it('derives duration from start and end, to the second, and costs it', async () => {
    const e = await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T16:30:30Z'));
    expect(e).toEqual(expect.objectContaining({
      durationSeconds: 5430, laborCost: 113.13, startTime: '2026-01-05T15:00:00.000Z', endTime: '2026-01-05T16:30:30.000Z',
    }));
    expect((await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T15:00:20Z'))).laborCost).toBe(0.42);
  });

  it('measures across the DST change and midnight by the clock', async () => {
    expect((await log(tech.agent, span('2026-03-08T07:30:00Z', '2026-03-08T08:30:00Z'))).durationSeconds).toBe(3600);
    expect((await log(tech.agent, span('2026-03-09T23:30:00Z', '2026-03-10T00:30:00Z'))).durationSeconds).toBe(3600);
  });

  it('rejects a backwards, empty or unreadable span', async () => {
    const cases = [
      [span('2026-01-05T16:00:00Z', '2026-01-05T15:00:00Z'), 'End time must be after start time'],
      [span('2026-01-05T15:00:00Z', '2026-01-05T15:00:00Z'), 'End time must be after start time'],
      [span('garbage', '2026-01-05T15:00:00Z'), 'Invalid start/end time'],
      [{ startTime: '2026-01-05T15:00:00Z' }, 'Send both startTime and endTime'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send(body)).body).toEqual(err(message));
    }
  });

  it('half a span with a duration uses the duration', async () => {
    const e = await log(tech.agent, { startTime: '2026-01-05T15:00:00Z', durationMinutes: 10 });
    expect([e.durationSeconds, e.startTime]).toEqual([600, null]);
  });
});

describe('entry dates', () => {
  it('keeps a past entryDate, trims a timestamp to its date, and refuses a non-date', async () => {
    expect((await log(tech.agent, { durationMinutes: 5, entryDate: '2026-01-05' })).entryDate).toBe('2026-01-05');
    expect((await log(tech.agent, { durationMinutes: 5, entryDate: '2026-01-05T22:00:00Z' })).entryDate).toBe('2026-01-05');
    for (const entryDate of ['garbage', '2026-02-30']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, entryDate })).body).toEqual(err('Invalid entry date'));
    }
  });

  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  it('Q14: "today" is the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z');
    const late = await makeTech('late', w.deptA.id); // log in under the frozen clock
    expect(expectOk(await late.agent.post(timeUrl()).send({ durationMinutes: 5 }), 201).entry.entryDate).toBe('2026-03-09');
    const future = await late.agent.post(timeUrl()).send({ durationMinutes: 5, entryDate: '2026-03-10' });
    expect(future.body).toEqual(err('Entry date cannot be in the future'));
  });
});

describe('work type, billable and task', () => {
  it('billable defaults from the work type, and can be overridden', async () => {
    const admin = await models.WorkType.findOne({ where: { name: 'Admin' } });
    const e = await log(tech.agent, { durationMinutes: 5, workTypeId: admin.id });
    expect([e.workType.name, e.billable]).toEqual(['Admin', false]);
    expect((await log(tech.agent, { durationMinutes: 5, workTypeId: admin.id, billable: true })).billable).toBe(true);
    expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, billable: 'yes' })).body).toEqual(err('billable must be true or false'));
  });

  it('refuses an unknown or inactive work type', async () => {
    const travel = await models.WorkType.findOne({ where: { name: 'Travel' } });
    await travel.update({ isActive: false });
    try {
      for (const workTypeId of [99999, '1abc', travel.id]) {
        // eslint-disable-next-line no-await-in-loop
        expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, workTypeId })).body).toEqual(err('Unknown work type'));
      }
    } finally {
      await travel.update({ isActive: true }); // work types are seeded, not reset
    }
  });

  it('logs against a ticket task, never another ticket\'s', async () => {
    const task = expectOk(await tech.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Toner' }), 201).task;
    const e = await log(tech.agent, { durationMinutes: 5, taskId: task.id });
    expect(e.task).toEqual({ id: task.id, title: 'Toner', code: task.code });
    const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const otherTask = expectOk(await w.admin.agent.post(`${API}/tickets/${other.id}/tasks`).send({ title: 'x' }), 201).task;
    for (const taskId of [otherTask.id, '1abc']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, taskId })).body).toEqual(err('Task does not belong to this ticket'));
    }
  });
});

describe('editing (new on tickets)', () => {
  it('edits every field, recosts it and audits it', async () => {
    const e = await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T16:30:00Z'));
    expect(e.laborCost).toBe(112.5);
    const edited = expectOk(await patch(ctr.agent, e, {
      ...span('2026-01-05T15:00:00Z', '2026-01-05T15:30:00Z'), note: 'shorter', entryDate: '2026-01-04', billable: false,
    })).entry;
    expect(edited).toEqual(expect.objectContaining({ durationSeconds: 1800, laborCost: 37.5, note: 'shorter', entryDate: '2026-01-04', billable: false }));
    expect(await models.AuditLog.count({ where: { entityType: 'TimeEntry', action: 'time.update' } })).toBe(1);
    const toPlain = expectOk(await patch(ctr.agent, e, { durationMinutes: 60 })).entry;
    expect([toPlain.durationSeconds, toPlain.startTime, toPlain.laborCost]).toEqual([3600, null, 75]);
  });

  it('refuses a future work date on edit too', async () => {
    const e = await log(tech.agent, { durationMinutes: 5 });
    expect((await patch(tech.agent, e, { entryDate: '2099-01-01' })).body).toEqual(err('Entry date cannot be in the future'));
    expect((await patch(tech.agent, e, { entryDate: null })).body).toEqual(err('Invalid entry date'));
  });
});

describe('listing and activity', () => {
  it('lists newest first with whole-ticket totals', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const fresh = await makeTech('frozen', w.deptA.id);
    for (const durationMinutes of [10, 20, 30]) {
      // eslint-disable-next-line no-await-in-loop
      await log(fresh.agent, { durationMinutes });
      advanceClock(1000);
    }
    const body = expectOk(await fresh.agent.get(`${timeUrl()}?limit=1`));
    expect(body.entries.map((e) => e.durationSeconds)).toEqual([1800]);
    expect(body).toEqual(expect.objectContaining({ total: 3, totalPages: 3, totalSeconds: 3600, totalLaborCost: null }));
  });

  it('entries written in the same second list newest id first', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const fresh = await makeTech('frozen', w.deptA.id);
    const a = await log(fresh.agent, { durationMinutes: 1 });
    const b = await log(fresh.agent, { durationMinutes: 2 });
    expect(expectOk(await fresh.agent.get(timeUrl())).entries.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('logs a time_logged activity entry', async () => {
    await log(tech.agent, { durationMinutes: 45 });
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
    const entry = activity.find((a) => a.action === 'time_logged');
    expect([entry.fromValue, entry.toValue, entry.user.username]).toEqual([null, '45m', 'tech']);
  });

  it('a ticket with no time', async () => {
    expect(expectOk(await tech.agent.get(timeUrl()))).toEqual({
      entries: [], page: 1, limit: 25, total: 0, totalPages: 1, totalSeconds: 0, totalLaborCost: null,
    });
  });
});

describe('deleting', () => {
  it('users delete their own entries, audited', async () => {
    const e = await log(tech.agent, { durationMinutes: 5 });
    expect(expectOk(await tech.agent.delete(`${timeUrl()}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(timeUrl())).entries).toEqual([]);
    expect(await models.AuditLog.count({ where: { entityType: 'TimeEntry', action: 'time.delete' } })).toBe(1);
  });

  it('an entry from another ticket is not found through this one', async () => {
    const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const e = await log(w.admin.agent, { durationMinutes: 5 }, t2);
    for (const res of [await w.admin.agent.delete(`${timeUrl()}/${e.id}`), await patch(w.admin.agent, e, { note: 'x' })]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Time entry not found', code: 'NOT_FOUND' });
    }
  });

  it('deleting the ticket deletes its time and tasks', async () => {
    await log(tech.agent, { durationMinutes: 5 });
    expectOk(await tech.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'x' }), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${ticket.id}`));
    expect(await models.TimeEntry.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect(await models.Task.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});

it('own-tier users can\'t log or list on others\' tickets', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  for (const res of [await own.agent.get(timeUrl()), await own.agent.post(timeUrl()).send({ durationMinutes: 5 })]) {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this ticket');
  }
});
