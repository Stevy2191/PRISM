const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeTech, makeTicket, makeProject, makeTask, makeSubtask,
} = require('./fixtures');

// Phases and the new project-task fields (sub-project 6, task 3).

let w;
let proj;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  proj = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
});
afterAll(closeDb);

const phasesUrl = (p = proj) => `${API}/projects/${p.id}/phases`;
const taskUrl = (t, p = proj) => `${API}/projects/${p.id}/tasks/${t.id}`;
const addPhase = async (name, p = proj) => expectOk(await w.admin.agent.post(phasesUrl(p)).send({ name }), 201).phase;
const listPhases = async (p = proj) => expectOk(await w.admin.agent.get(phasesUrl(p))).phases;
const patchTask = (t, body, p = proj) => w.admin.agent.patch(taskUrl(t, p)).send(body);

describe('phases', () => {
  it('phases list with derived dates and counts', async () => {
    const a = await addPhase('Build');
    const b = await addPhase('Rollout');
    expect(b.position).toBeGreaterThan(a.position);
    const t1 = await makeTask(w.admin.agent, proj.id, { title: 'One', estimateMinutes: 60 });
    const t2 = await makeTask(w.admin.agent, proj.id, { title: 'Two', estimateMinutes: 30 });
    await makeTask(w.admin.agent, proj.id, { title: 'Loose' });
    expectOk(await patchTask(t1, { phaseId: a.id, startDate: '2026-03-02', dueDate: '2026-03-06' }));
    expectOk(await patchTask(t2, { phaseId: a.id, startDate: '2026-03-04', dueDate: '2026-03-20' }));
    const sub = await makeSubtask(w.admin.agent, proj.id, t1.id, { title: 'Sub' });
    const closed = await models.TaskStatus.findOne({ where: { behaviorType: 'closed' } });
    expectOk(await patchTask(t2, { statusId: closed.id }));
    // Time on the task and on its subtask, from two different users.
    const tech = await makeTech('tech', w.deptA.id);
    const base = { entryDate: '2026-03-03' };
    expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/time-entries`).send({ ...base, durationMinutes: 30, taskId: t1.id }), 201);
    expectOk(await tech.agent.post(`${API}/projects/${proj.id}/time-entries`).send({ ...base, durationMinutes: 15, taskId: sub.id }), 201);
    const [pa, pb] = await listPhases();
    expect(pa).toEqual(expect.objectContaining({
      id: a.id, name: 'Build', hourBudgetMinutes: null, startDate: '2026-03-02', dueDate: '2026-03-20',
      taskCount: 2, doneCount: 1, loggedMinutes: 45, estimateMinutes: 90,
    }));
    expect(pb).toEqual(expect.objectContaining({
      id: b.id, startDate: null, dueDate: null, taskCount: 0, doneCount: 0, loggedMinutes: 0, estimateMinutes: 0,
    }));
  });

  it('create/rename/reorder/delete are audited', async () => {
    const a = await addPhase('Build');
    const b = await addPhase('Rollout');
    expectOk(await w.admin.agent.patch(`${phasesUrl()}/${a.id}`).send({ name: 'Construction', hourBudgetMinutes: 600 }));
    expectOk(await w.admin.agent.patch(`${phasesUrl()}/reorder`).send({ ids: [b.id, a.id] }));
    expect((await listPhases()).map((p) => p.id)).toEqual([b.id, a.id]);
    expect((await listPhases())[1]).toEqual(expect.objectContaining({ name: 'Construction', hourBudgetMinutes: 600 }));
    expectOk(await w.admin.agent.delete(`${phasesUrl()}/${b.id}`));
    const rows = await models.AuditLog.findAll({ where: { entityType: 'ProjectPhase' }, order: [['id', 'ASC']] });
    expect(rows.map((r) => r.action)).toEqual([
      'projectPhase.create', 'projectPhase.create', 'projectPhase.update', 'projectPhase.reorder', 'projectPhase.delete',
    ]);
  });

  it('reorder missing an id → 400', async () => {
    const a = await addPhase('Build');
    await addPhase('Rollout');
    const res = await w.admin.agent.patch(`${phasesUrl()}/reorder`).send({ ids: [a.id] });
    expect(res.status).toBe(400);
    expect((await listPhases())[0].id).toBe(a.id);
  });

  it('view-only user → 403 on writes', async () => {
    const a = await addPhase('Build');
    const viewer = await makeStaff('viewer', w.deptA.id);
    expect((await viewer.agent.get(phasesUrl())).status).toBe(200);
    for (const res of [
      await viewer.agent.post(phasesUrl()).send({ name: 'x' }),
      await viewer.agent.patch(`${phasesUrl()}/${a.id}`).send({ name: 'x' }),
      await viewer.agent.patch(`${phasesUrl()}/reorder`).send({ ids: [a.id] }),
      await viewer.agent.delete(`${phasesUrl()}/${a.id}`),
    ]) expect(res.status).toBe(403);
    expect(await listPhases()).toHaveLength(1);
  });

  it('PATCH task phaseId from another project → 404, phase unchanged', async () => {
    const other = await makeProject(w.admin.agent, { name: 'Other', ownerDepartmentId: w.deptA.id });
    const foreign = await addPhase('Foreign', other);
    const mine = await addPhase('Mine');
    const task = await makeTask(w.admin.agent, proj.id);
    expectOk(await patchTask(task, { phaseId: mine.id }));
    const res = await patchTask(task, { phaseId: foreign.id });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await models.Task.findByPk(task.id)).phaseId).toBe(mine.id);
    // Phase routes are fenced the same way.
    expect((await w.admin.agent.patch(`${phasesUrl()}/${foreign.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await w.admin.agent.delete(`${phasesUrl()}/${foreign.id}`)).status).toBe(404);
    expect((await w.admin.agent.patch(`${phasesUrl()}/reorder`).send({ ids: [mine.id, foreign.id] })).status).toBe(404);
  });

  it('DELETE phase → its tasks have phaseId null', async () => {
    const a = await addPhase('Build');
    const task = await makeTask(w.admin.agent, proj.id);
    expectOk(await patchTask(task, { phaseId: a.id }));
    expectOk(await w.admin.agent.delete(`${phasesUrl()}/${a.id}`));
    expect((await models.Task.findByPk(task.id)).phaseId).toBeNull();
    expect(await listPhases()).toEqual([]);
  });
});

describe('task fields', () => {
  it('ticket task with phaseId → 400 PROJECT_TASK_ONLY', async () => {
    const ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
    const a = await addPhase('Build');
    const res = await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'x', phaseId: a.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROJECT_TASK_ONLY');
    const task = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'x' }), 201).task;
    for (const body of [{ phaseId: a.id }, { startDate: '2026-03-01' }, { isMilestone: true }]) {
      const r = await w.admin.agent.patch(`${API}/tickets/${ticket.id}/tasks/${task.id}`).send(body);
      expect([r.status, r.body.code]).toEqual([400, 'PROJECT_TASK_ONLY']);
    }
  });

  it('startDate after dueDate → 400 START_AFTER_DUE', async () => {
    const task = await makeTask(w.admin.agent, proj.id, { dueDate: '2026-03-10' });
    const res = await patchTask(task, { startDate: '2026-03-11' });
    expect([res.status, res.body.code]).toEqual([400, 'START_AFTER_DUE']);
    const res2 = await w.admin.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', startDate: '2026-03-11', dueDate: '2026-03-10' });
    expect([res2.status, res2.body.code]).toEqual([400, 'START_AFTER_DUE']);
    expect((await patchTask(task, { startDate: '2026-3-1' })).status).toBe(400);
    expect((await models.Task.findByPk(task.id)).startDate).toBeNull();
  });

  it('milestone forces start=due and estimate null', async () => {
    const task = await makeTask(w.admin.agent, proj.id, { estimateMinutes: 90 });
    const m = expectOk(await patchTask(task, { isMilestone: true, dueDate: '2026-04-01' })).task;
    expect(m).toEqual(expect.objectContaining({ isMilestone: true, startDate: '2026-04-01', dueDate: '2026-04-01', estimateMinutes: null }));
    const m2 = expectOk(await patchTask(task, { startDate: '2026-04-05' })).task;
    expect([m2.startDate, m2.dueDate]).toEqual(['2026-04-05', '2026-04-05']);
    const m3 = expectOk(await patchTask(task, { estimateMinutes: 30 })).task;
    expect(m3.estimateMinutes).toBeNull();
    const created = await makeTask(w.admin.agent, proj.id, { isMilestone: true, startDate: '2026-05-01', estimateMinutes: 5 });
    expect([created.startDate, created.dueDate, created.estimateMinutes]).toEqual(['2026-05-01', '2026-05-01', null]);
  });

  it('milestone on a task with subtasks → 400 MILESTONE_HAS_SUBTASKS', async () => {
    const task = await makeTask(w.admin.agent, proj.id);
    await makeSubtask(w.admin.agent, proj.id, task.id);
    const res = await patchTask(task, { isMilestone: true });
    expect([res.status, res.body.code]).toEqual([400, 'MILESTONE_HAS_SUBTASKS']);
    expect((await models.Task.findByPk(task.id)).isMilestone).toBe(false);
  });

  it('subtask under a milestone → 400 MILESTONE_HAS_SUBTASKS', async () => {
    const task = await makeTask(w.admin.agent, proj.id, { isMilestone: true, dueDate: '2026-04-01' });
    const res = await w.admin.agent.post(`${taskUrl(task)}/subtasks`).send({ title: 'x' });
    expect([res.status, res.body.code]).toEqual([400, 'MILESTONE_HAS_SUBTASKS']);
    const res2 = await w.admin.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', parentTaskId: task.id });
    expect([res2.status, res2.body.code]).toEqual([400, 'MILESTONE_HAS_SUBTASKS']);
  });

  it('subtask phaseId ignored, follows parent', async () => {
    const a = await addPhase('Build');
    const task = await makeTask(w.admin.agent, proj.id, { phaseId: a.id });
    expect(task.phaseId).toBe(a.id);
    const sub = await makeSubtask(w.admin.agent, proj.id, task.id, { phaseId: a.id, startDate: '2026-03-02' });
    expect([sub.phaseId, sub.startDate]).toEqual([null, '2026-03-02']);
    const upd = expectOk(await patchTask(sub, { phaseId: a.id })).task;
    expect(upd.phaseId).toBeNull();
  });
});
