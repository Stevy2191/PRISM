const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeProject, makeTask, makeSubtask,
  setSettings, freezeClock, unfreezeClock,
} = require('./fixtures');

// Project time on the one ledger (sub-project 3): the same body and rules as
// ticket time. Who may log for whom: time.permissions.test.js.

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
const patch = (agent, e, body) => agent.patch(`${url()}/${e.id}`).send(body);
const today = () => new Date().toISOString().slice(0, 10);
const err = (message) => ({ error: true, message, code: 'VALIDATION_ERROR' });

describe('logging', () => {
  it('logs a span against a task', async () => {
    const e = await log(ctr.agent, { ...span('15:00', '16:30'), note: 'Rack', taskId: task.id, entryDate: '2026-01-05' });
    expect(e).toEqual(expect.objectContaining({
      projectId: proj.id, ticketId: null, taskId: task.id, userId: ctr.user.id, loggedById: ctr.user.id, note: 'Rack',
      durationSeconds: 5400, entryDate: '2026-01-05', laborCost: 112.5, billable: true,
    }));
    expect([e.task, e.workType.name]).toEqual([{ id: task.id, title: 'Rack', code: task.code }, 'Project work']);
  });

  it('a plain duration works on projects too', async () => {
    const e = await log(tech.agent, { durationMinutes: 30 });
    expect(e).toEqual(expect.objectContaining({ durationSeconds: 1800, startTime: null, entryDate: today(), note: null, taskId: null }));
  });

  it('logs against a subtask of this project, never another project\'s task', async () => {
    const sub = await makeSubtask(w.admin.agent, proj.id, task.id, { title: 'Cable' });
    expect((await log(tech.agent, { durationMinutes: 5, taskId: sub.id })).taskId).toBe(sub.id);
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const qTask = await makeTask(w.admin.agent, q.id);
    expect((await tech.agent.post(url()).send({ ...span('09:00', '10:00'), taskId: qTask.id })).body)
      .toEqual(err('Task does not belong to this project'));
  });

  it('the old body fields are not read', async () => {
    const e = await log(w.admin.agent, { ...span('15:00', '16:00'), loggedForUserId: ctr.user.id, description: 'old' });
    expect([e.userId, e.note]).toEqual([w.admin.user.id, null]);
  });

  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  it('Q14: "today" is the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z');
    const late = await makeTech('late', w.deptA.id);
    const body = { startTime: '2026-03-10T02:00:00Z', endTime: '2026-03-10T03:00:00Z' };
    expect((await late.agent.post(url()).send({ ...body, entryDate: '2026-03-10' })).body).toEqual(err('Entry date cannot be in the future'));
    expect((await log(late.agent, body)).entryDate).toBe('2026-03-09');
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
});

describe('editing', () => {
  it('edits note, date, task and span', async () => {
    const e = await log(tech.agent, { ...span('09:00', '10:00'), taskId: task.id });
    const changes = { note: 'new', entryDate: '2026-01-04', taskId: null };
    expect(expectOk(await patch(tech.agent, e, changes)).entry).toEqual(expect.objectContaining(changes));
    expect(expectOk(await patch(tech.agent, e, span('10:00', '10:45'))).entry.durationSeconds).toBe(2700);
  });

  it('Q1: editing the span recomputes labour cost', async () => {
    const e = await log(ctr.agent, span('15:00', '16:30'));
    const edited = expectOk(await patch(ctr.agent, e, span('15:00', '15:30'))).entry;
    expect([edited.durationSeconds, edited.laborCost]).toEqual([1800, 37.5]);
  });

  it('Q2: editing writes an audit row', async () => {
    const e = await log(ctr.agent, span('15:00', '16:30'));
    expectOk(await patch(ctr.agent, e, { note: 'changed' }));
    const actions = (await models.AuditLog.findAll({ where: { entityType: 'TimeEntry' }, order: [['id', 'ASC']] })).map((r) => r.action);
    expect(actions).toEqual(['time.create', 'time.update']);
  });

  it('Q3: editing refuses a future entryDate', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect((await patch(tech.agent, e, { entryDate: '2099-01-01' })).body).toEqual(err('Entry date cannot be in the future'));
  });

  it('Q22: editing refuses another project\'s task', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const qTask = await makeTask(w.admin.agent, q.id);
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect((await patch(tech.agent, e, { taskId: qTask.id })).body).toEqual(err('Task does not belong to this project'));
  });

  it('edit validates a given span and refuses half of one', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect((await patch(tech.agent, e, { startTime: 'garbage', endTime: 'x' })).body).toEqual(err('Invalid start/end time'));
    expect((await patch(tech.agent, e, span('11:00', '10:00'))).body).toEqual(err('End time must be after start time'));
    expect((await patch(tech.agent, e, { startTime: '2026-01-05T08:00:00Z' })).body).toEqual(err('Send both startTime and endTime'));
  });
});

describe('deleting and scope', () => {
  it('users delete their own entries', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect(expectOk(await tech.agent.delete(`${url()}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(url())).entries).toEqual([]);
  });

  it('an entry from another project is not found through this one', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const e = await log(w.admin.agent, span('09:00', '10:00'), q);
    for (const res of [await patch(w.admin.agent, e, { note: 'x' }), await w.admin.agent.delete(`${url()}/${e.id}`)]) {
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
