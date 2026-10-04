const { resetData, closeDb, ROLE, createUserAndLogin } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeUser, makeOwnTier, makeContractor, makeTicket,
  makeTeam, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Baseline for ticket time: what is stored, how it is rounded and costed,
// who may log it for whom, and who may delete it. Sub-project 3 merges this
// with project time into one ledger; these pin the ticket half.

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
const span = (startTime, endTime) => ({ startTime, endTime });
const today = () => new Date().toISOString().slice(0, 10);
const leadWithTeam = async () => {
  const lead = await makeTech('lead', w.deptA.id);
  await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }, { userId: tech.user.id, isLead: false }]);
  return lead;
};

describe('logging minutes', () => {
  it('logs minutes', async () => {
    const e = await log(tech.agent, { minutes: 45, note: 'Fuser' });
    expect(e).toEqual(expect.objectContaining({
      ticketId: ticket.id, userId: tech.user.id, loggedById: tech.user.id, minutes: 45, durationSeconds: 2700,
      startTime: null, endTime: null, note: 'Fuser', entryDate: today(), laborCost: null,
    }));
    expect(e.user.username).toBe('tech');
    expect(e.loggedBy.username).toBe('tech');
  });

  it('accepts minutes as a numeric string and truncates fractions', async () => {
    expect((await log(tech.agent, { minutes: '30' })).minutes).toBe(30);
    expect((await log(tech.agent, { minutes: 1.9 })).minutes).toBe(1);
  });

  it('rejects minutes that aren\'t a positive integer', async () => {
    for (const body of [{ minutes: 0 }, { minutes: -5 }, { minutes: 'abc' }, {}]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(timeUrl()).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'minutes must be a positive integer', code: 'VALIDATION_ERROR' });
    }
  });
});

describe('logging a span', () => {
  it('derives duration from start and end, to the second', async () => {
    const e = await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T16:30:30Z'));
    expect(e).toEqual(expect.objectContaining({
      durationSeconds: 5430, minutes: 91, laborCost: 113.13,
      startTime: '2026-01-05T15:00:00.000Z', endTime: '2026-01-05T16:30:30.000Z',
    }));
  });

  it('a very short span still counts as one minute', async () => {
    const e = await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T15:00:20Z'));
    expect(e).toEqual(expect.objectContaining({ durationSeconds: 20, minutes: 1, laborCost: 0.42 }));
  });

  it('measures across the DST change by the clock, not the wall', async () => {
    const e = await log(tech.agent, span('2026-03-08T07:30:00Z', '2026-03-08T08:30:00Z'));
    expect(e).toEqual(expect.objectContaining({ durationSeconds: 3600, minutes: 60 }));
  });

  it('measures across midnight UTC', async () => {
    expect((await log(tech.agent, span('2026-03-09T23:30:00Z', '2026-03-10T00:30:00Z'))).durationSeconds).toBe(3600);
  });

  it('rejects a backwards, empty or unreadable span', async () => {
    const cases = [
      [span('2026-01-05T16:00:00Z', '2026-01-05T15:00:00Z'), 'End time must be after start time'],
      [span('2026-01-05T15:00:00Z', '2026-01-05T15:00:00Z'), 'End time must be after start time'],
      [span('garbage', '2026-01-05T15:00:00Z'), 'Invalid start/end time'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(timeUrl()).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('uses minutes when only one of start and end is given', async () => {
    const e = await log(tech.agent, { startTime: '2026-01-05T15:00:00Z', minutes: 10 });
    expect(e).toEqual(expect.objectContaining({ minutes: 10, startTime: null }));
  });
});

describe('entry dates', () => {
  it('keeps a past entryDate and trims a timestamp to its date', async () => {
    expect((await log(tech.agent, { minutes: 5, entryDate: '2026-01-05' })).entryDate).toBe('2026-01-05');
    expect((await log(tech.agent, { minutes: 5, entryDate: '2026-01-05T22:00:00Z' })).entryDate).toBe('2026-01-05');
  });

  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  // Likely correct: "today" is the user's local date. Expected to change in sub-project 3.
  it('[quirk] Q14: "today" for entryDate is the UTC date', async () => {
    freezeClock('2026-03-10T03:30:00Z');
    const fresh = await makeTech('late', w.deptA.id); // log in under the frozen clock
    const byDefault = expectOk(await fresh.agent.post(timeUrl()).send({ minutes: 5 }), 201).entry;
    expect(byDefault.entryDate).toBe('2026-03-10');
    expect((await fresh.agent.post(timeUrl()).send({ minutes: 5, entryDate: '2026-03-10' })).status).toBe(201);
    const future = await fresh.agent.post(timeUrl()).send({ minutes: 5, entryDate: '2026-03-11' });
    expect(future.status).toBe(400);
    expect(future.body.message).toBe('Entry date cannot be in the future');
  });
});

describe('logging for someone else', () => {
  it('a user\'s own id sent as a string is "themselves"', async () => {
    const e = await log(tech.agent, { minutes: 5, userId: String(tech.user.id) });
    expect(e).toEqual(expect.objectContaining({ userId: tech.user.id, loggedById: tech.user.id }));
  });

  it('only admins and team leads log for others', async () => {
    const res = await tech.agent.post(timeUrl()).send({ minutes: 5, userId: ctr.user.id });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'Only admins and team leads can log time for other users', code: 'FORBIDDEN' });
  });

  it('an admin logs for someone, and their rate applies', async () => {
    const e = await log(w.admin.agent, { minutes: 60, userId: ctr.user.id });
    expect(e).toEqual(expect.objectContaining({ userId: ctr.user.id, loggedById: w.admin.user.id, laborCost: 75 }));
  });

  it('the target must exist and hold projects.log_time', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    for (const userId of [ro.user.id, 99999]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await w.admin.agent.post(timeUrl()).send({ minutes: 5, userId });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'Invalid user to log time for', code: 'VALIDATION_ERROR' });
    }
  });

  it('a team lead logs for a teammate', async () => {
    const lead = await leadWithTeam();
    const e = await log(lead.agent, { minutes: 30, userId: tech.user.id });
    expect(e).toEqual(expect.objectContaining({ userId: tech.user.id, loggedById: lead.user.id }));
  });

  // Likely correct: only for members of a team they lead. Expected to change in sub-project 3.
  it('[quirk] Q21: any team lead logs for anyone, teammate or not', async () => {
    const lead = await leadWithTeam();
    const mgr = await makeManager('mgr', w.deptA.id);
    expect((await lead.agent.post(timeUrl()).send({ minutes: 30, userId: mgr.user.id })).status).toBe(201);
  });

  // Likely correct: a granular permission decides. Expected to change in sub-project 3.
  it('[quirk] Q6: logging for others checks the legacy admin role', async () => {
    const granular = await createUserAndLogin({ username: 'granular', roleName: ROLE.ADMIN, legacyRole: 'technician' });
    expect((await granular.agent.post(timeUrl()).send({ minutes: 5, userId: tech.user.id })).status).toBe(403);
  });
});

describe('cost, listing and activity', () => {
  it('a contractor with no rate has no labour cost', async () => {
    const norate = await makeContractor(w.admin, 'norate', w.deptA.id, { rate: null });
    expect((await log(norate.agent, { minutes: 60 })).laborCost).toBeNull();
  });

  it('lists newest first with a whole-ticket total', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    for (const minutes of [10, 20, 30]) {
      // eslint-disable-next-line no-await-in-loop
      await log(tech.agent, { minutes });
      advanceClock(1000);
    }
    const body = expectOk(await tech.agent.get(`${timeUrl()}?limit=1`));
    expect(body.entries.map((e) => e.minutes)).toEqual([30]);
    expect(body).toEqual(expect.objectContaining({ total: 3, totalPages: 3, totalMinutes: 60 }));
  });

  it('logs a time_logged activity entry', async () => {
    await log(tech.agent, { minutes: 45 });
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
    const entry = activity.find((a) => a.action === 'time_logged');
    expect([entry.fromValue, entry.toValue, entry.user.username]).toEqual([null, '45m', 'tech']);
  });

  it('a ticket with no time', async () => {
    expect(expectOk(await tech.agent.get(timeUrl()))).toEqual({
      entries: [], page: 1, limit: 25, total: 0, totalPages: 1, totalMinutes: 0,
    });
  });
});

describe('deleting time', () => {
  it('users delete their own entries', async () => {
    const e = await log(tech.agent, { minutes: 5 });
    expect(expectOk(await tech.agent.delete(`${timeUrl()}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(timeUrl())).entries).toEqual([]);
  });

  it('only admins delete other people\'s entries', async () => {
    const e = await log(ctr.agent, { minutes: 5 });
    const refused = await tech.agent.delete(`${timeUrl()}/${e.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: true, message: 'You can only remove your own time entries', code: 'FORBIDDEN' });
    expect((await w.admin.agent.delete(`${timeUrl()}/${e.id}`)).status).toBe(200);
  });

  // Likely correct: the logger and the person it's for may both remove it. Expected to change in sub-project 3.
  it('[quirk] Q4: on tickets, "own entry" means the person it\'s for', async () => {
    const lead = await leadWithTeam();
    const e = await log(lead.agent, { minutes: 30, userId: tech.user.id });
    expect((await lead.agent.delete(`${timeUrl()}/${e.id}`)).status).toBe(403);
    expect((await tech.agent.delete(`${timeUrl()}/${e.id}`)).status).toBe(200);
  });

  it('an entry from another ticket is not found through this one', async () => {
    const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const e = await log(w.admin.agent, { minutes: 5 }, t2);
    const res = await w.admin.agent.delete(`${timeUrl()}/${e.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Time entry not found', code: 'NOT_FOUND' });
  });
});

it('own-tier users can\'t log or list on others\' tickets', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  for (const res of [await own.agent.get(timeUrl()), await own.agent.post(timeUrl()).send({ minutes: 5 })]) {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this ticket');
  }
});
