const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeProject, makeTask,
  freezeClock, unfreezeClock,
} = require('./fixtures');

// Baseline for project time: spans, task links, editing, and who may log,
// edit or delete it. Sub-project 3 merges this with ticket time.

let w;
let tech;
let ctr;
let proj;
let task;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 75 });
  proj = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  task = await makeTask(w.admin.agent, proj.id, { title: 'Rack' });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const url = (p = proj) => `${API}/projects/${p.id}/time-entries`;
const span = (start, end) => ({ startTime: `2026-01-05T${start}:00Z`, endTime: `2026-01-05T${end}:00Z` });
const log = async (agent, body, p) => expectOk(await agent.post(url(p)).send(body), 201).entry;
const today = () => new Date().toISOString().slice(0, 10);
// No endpoint reads AuditLogs.
const auditRows = () => models.AuditLog.count({ where: { entityType: 'ProjectTimeEntry' } });

describe('logging', () => {
  it('logs a span against a task', async () => {
    const e = await log(ctr.agent, { ...span('15:00', '16:30'), description: 'Rack', taskId: task.id, entryDate: '2026-01-05' });
    expect(e).toEqual(expect.objectContaining({
      projectId: proj.id, taskId: task.id, userId: ctr.user.id, loggedForUserId: ctr.user.id, description: 'Rack',
      durationSeconds: 5400, entryDate: '2026-01-05', laborCost: 112.5,
    }));
    expect(e.task).toEqual({ id: task.id, title: 'Rack' });
  });

  it('defaults', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect(e).toEqual(expect.objectContaining({ entryDate: today(), description: null, taskId: null, laborCost: null }));
  });

  it('requires a valid forward span', async () => {
    const cases = [
      [{ minutes: 30 }, 'Invalid start/end time'],
      [span('16:00', '15:00'), 'End time must be after start time'],
      [span('15:00', '15:00'), 'End time must be after start time'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(url()).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('a task must belong to this project', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const qTask = await makeTask(w.admin.agent, q.id);
    const res = await tech.agent.post(url()).send({ ...span('09:00', '10:00'), taskId: qTask.id });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'Task does not belong to this project', code: 'VALIDATION_ERROR' });
  });

  it('measures across the DST change by the clock', async () => {
    const e = await log(tech.agent, { startTime: '2026-03-08T07:30:00Z', endTime: '2026-03-08T08:30:00Z' });
    expect(e.durationSeconds).toBe(3600);
  });

  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  // Likely correct: "today" is the user's local date. Expected to change in sub-project 3.
  it('[quirk] Q14: rejects a future entryDate and uses UTC "today"', async () => {
    freezeClock('2026-03-10T03:30:00Z');
    const fresh = await makeTech('late', w.deptA.id);
    const body = { startTime: '2026-03-10T02:00:00Z', endTime: '2026-03-10T03:00:00Z' };
    const future = await fresh.agent.post(url()).send({ ...body, entryDate: '2026-03-11' });
    expect(future.status).toBe(400);
    expect(future.body.message).toBe('Entry date cannot be in the future');
    expect((await log(fresh.agent, body)).entryDate).toBe('2026-03-10');
  });

  it('logging for others follows the ticket rules', async () => {
    const refused = await tech.agent.post(url()).send({ ...span('15:00', '16:00'), loggedForUserId: ctr.user.id });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('Only admins and team leads can log time for other users');
    const e = await log(w.admin.agent, { ...span('15:00', '16:00'), loggedForUserId: ctr.user.id });
    expect(e).toEqual(expect.objectContaining({ userId: w.admin.user.id, loggedForUserId: ctr.user.id, laborCost: 75 }));
    const ghost = await w.admin.agent.post(url()).send({ ...span('15:00', '16:00'), loggedForUserId: 99999 });
    expect(ghost.status).toBe(400);
    expect(ghost.body.message).toBe('Invalid user to log time for');
  });

  it('a user\'s own id as a string is "themselves"', async () => {
    const e = await log(tech.agent, { ...span('09:00', '10:00'), loggedForUserId: String(tech.user.id) });
    expect(e).toEqual(expect.objectContaining({ userId: tech.user.id, loggedForUserId: tech.user.id }));
  });

  it('lists newest first with whole-project totals', async () => {
    await log(tech.agent, span('09:00', '10:00'));
    expect(expectOk(await tech.agent.get(url()))).toEqual(expect.objectContaining({ totalSeconds: 3600, totalLaborCost: null }));
    await log(ctr.agent, span('15:00', '16:30'));
    const body = expectOk(await tech.agent.get(`${url()}?limit=1`));
    expect(body.entries).toHaveLength(1);
    expect(body).toEqual(expect.objectContaining({ total: 2, totalSeconds: 9000, totalLaborCost: 112.5 }));
  });

  it('logs a time_logged activity entry', async () => {
    await log(ctr.agent, span('15:00', '16:30'));
    const { activity } = expectOk(await tech.agent.get(`${API}/projects/${proj.id}/activity`));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['time_logged', { minutes: 90 }]);
  });

  it('a project with no time', async () => {
    expect(expectOk(await tech.agent.get(url()))).toEqual(expect.objectContaining({
      entries: [], total: 0, totalSeconds: 0, totalLaborCost: null,
    }));
  });
});

describe('editing', () => {
  const patch = (agent, e, body) => agent.patch(`${url()}/${e.id}`).send(body);

  it('edits description, date, task and span', async () => {
    const e = await log(tech.agent, { ...span('09:00', '10:00'), taskId: task.id });
    const changes = { description: 'new', entryDate: '2026-01-04', taskId: null };
    expect(expectOk(await patch(tech.agent, e, changes)).entry).toEqual(expect.objectContaining(changes));
    expect(expectOk(await patch(tech.agent, e, span('10:00', '10:45'))).entry.durationSeconds).toBe(2700);
  });

  // Likely correct: labour cost follows the corrected duration. Expected to change in sub-project 3.
  it('[quirk] Q1: editing start/end recomputes duration but not labour cost', async () => {
    const e = await log(ctr.agent, span('15:00', '16:30'));
    expect(e.laborCost).toBe(112.5);
    const edited = expectOk(await patch(ctr.agent, e, span('15:00', '15:30'))).entry;
    expect(edited.durationSeconds).toBe(1800);
    expect(edited.laborCost).toBe(112.5);
  });

  // Likely correct: edits are audited as project_time.update. Expected to change in sub-project 3.
  it('[quirk] Q2: editing writes no audit row', async () => {
    const e = await log(ctr.agent, span('15:00', '16:30'));
    expect(await auditRows()).toBe(1);
    expectOk(await patch(ctr.agent, e, { description: 'changed' }));
    expect(await auditRows()).toBe(1);
  });

  // Likely correct: 400, as on create. Expected to change in sub-project 3.
  it('[quirk] Q3: editing accepts a future entryDate', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect(expectOk(await patch(tech.agent, e, { entryDate: '2099-01-01' })).entry.entryDate).toBe('2099-01-01');
  });

  // Likely correct: 400 'Task does not belong to this project', as on create. Expected to change in sub-project 3.
  // Q22, fixed early as security finding S13 (it showed the other task's title).
  it('Q22: editing refuses another project\'s task', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const qTask = await makeTask(w.admin.agent, q.id);
    const e = await log(tech.agent, span('09:00', '10:00'));
    const res = await patch(tech.agent, e, { taskId: qTask.id });
    expect([res.status, res.body.message]).toEqual([400, 'Task does not belong to this project']);
  });

  it('edit validates a given span and ignores a half one', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    const bad = await patch(tech.agent, e, { startTime: 'garbage', endTime: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Invalid start/end time');
    const backwards = await patch(tech.agent, e, span('11:00', '10:00'));
    expect(backwards.status).toBe(400);
    expect(backwards.body.message).toBe('End time must be after start time');
    const half = expectOk(await patch(tech.agent, e, { startTime: '2026-01-05T08:00:00Z' })).entry;
    expect(half.durationSeconds).toBe(3600);
  });
});

describe('deleting and ownership', () => {
  it('users delete their own entries', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect(expectOk(await tech.agent.delete(`${url()}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(url())).entries).toEqual([]);
  });

  it('only admins edit or delete other people\'s entries', async () => {
    const e = await log(ctr.agent, span('09:00', '10:00'));
    const edit = await tech.agent.patch(`${url()}/${e.id}`).send({ description: 'x' });
    expect(edit.status).toBe(403);
    expect(edit.body.message).toBe('You can only edit your own time entries');
    const del = await tech.agent.delete(`${url()}/${e.id}`);
    expect(del.status).toBe(403);
    expect(del.body.message).toBe('You can only remove your own time entries');
    expect((await w.admin.agent.patch(`${url()}/${e.id}`).send({ description: 'x' })).status).toBe(200);
    expect((await w.admin.agent.delete(`${url()}/${e.id}`)).status).toBe(200);
  });

  // Likely correct: the person the time is for may edit it too. Expected to change in sub-project 3.
  it('[quirk] Q4: on projects, "own entry" means the logger', async () => {
    const e = await log(w.admin.agent, { ...span('09:00', '10:00'), loggedForUserId: ctr.user.id });
    expect((await ctr.agent.patch(`${url()}/${e.id}`).send({ description: 'x' })).status).toBe(403);
    expect((await ctr.agent.delete(`${url()}/${e.id}`)).status).toBe(403);
  });

  it('an entry from another project is not found through this one', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const e = await log(w.admin.agent, span('09:00', '10:00'), q);
    for (const res of [
      await w.admin.agent.patch(`${url()}/${e.id}`).send({ description: 'x' }),
      await w.admin.agent.delete(`${url()}/${e.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Time entry not found', code: 'NOT_FOUND' });
    }
  });

  it('own-tier users can\'t log or list on projects they aren\'t on', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    for (const res of [await own.agent.get(url()), await own.agent.post(url()).send(span('09:00', '10:00'))]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have access to this project');
    }
  });
});
