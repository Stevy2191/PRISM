const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeOwnTier, makeTicket, makeProject, makeTask,
  makeSubtask, projectStatusId, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S1: DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId', () => {
  it('refuses a task from another project, leaving its subtask in place', async () => {
    // A Department Manager in A can edit A's projects, not B's.
    const mgr = await makeManager('mgr', w.deptA.id);
    const projA = await makeProject(w.admin.agent, { name: 'A', ownerDepartmentId: w.deptA.id });
    const projB = await makeProject(w.admin.agent, { name: 'B', ownerDepartmentId: w.deptB.id });
    const taskB = await makeTask(w.admin.agent, projB.id, { title: 'B task' });
    const subB = await makeSubtask(w.admin.agent, projB.id, taskB.id, { title: 'B sub' });

    const res = await mgr.agent.delete(`${API}/projects/${projA.id}/tasks/${taskB.id}/subtasks/${subB.id}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Task not found');

    const tasks = expectOk(await w.admin.agent.get(`${API}/projects/${projB.id}/tasks`)).tasks;
    expect(tasks[0].subtasks.map((s) => s.id)).toEqual([subB.id]);
  });

  it('still deletes a subtask through its own project', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const projA = await makeProject(w.admin.agent, { name: 'A', ownerDepartmentId: w.deptA.id });
    const task = await makeTask(mgr.agent, projA.id);
    const sub = await makeSubtask(mgr.agent, projA.id, task.id);
    expectOk(await mgr.agent.delete(`${API}/projects/${projA.id}/tasks/${task.id}/subtasks/${sub.id}`));
    const tasks = expectOk(await mgr.agent.get(`${API}/projects/${projA.id}/tasks`)).tasks;
    expect(tasks[0].subtasks).toEqual([]);
  });
});

describe('S4: linkedTicketId on project tasks', () => {
  let mgr;
  let proj;
  let mine;
  let hidden;
  beforeEach(async () => {
    // Can edit department A's projects, can see only department A's tickets.
    mgr = await makeManager('mgr', w.deptA.id);
    proj = await makeProject(w.admin.agent, { name: 'A', ownerDepartmentId: w.deptA.id });
    mine = await makeTicket(w.admin.agent, { title: 'Visible', contactId: w.contact.id, departmentId: w.deptA.id });
    hidden = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
  });

  const refused = { error: true, message: 'Linked ticket not found', code: 'VALIDATION_ERROR' };

  it('create: an out-of-scope ticket and a missing one get the same 400', async () => {
    const out = await mgr.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', linkedTicketId: hidden.id });
    const missing = await mgr.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', linkedTicketId: 99999 });
    expect(out.status).toBe(400);
    expect(out.body).toEqual(refused);
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual(refused);
    expect(expectOk(await mgr.agent.get(`${API}/projects/${proj.id}/tasks`)).tasks).toEqual([]);
  });

  it('update: same rule, and the task keeps its old link', async () => {
    const task = await makeTask(mgr.agent, proj.id, { linkedTicketId: mine.id });
    const out = await mgr.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ linkedTicketId: hidden.id });
    expect(out.status).toBe(400);
    expect(out.body).toEqual(refused);
    const [fresh] = expectOk(await mgr.agent.get(`${API}/projects/${proj.id}/tasks`)).tasks;
    expect(fresh.linkedTicket).toEqual({ id: mine.id, title: 'Visible' });
  });

  it('re-sending a task\'s existing link unchanged is not a new link', async () => {
    // An admin linked a ticket the manager can't see; a client that PATCHes
    // the whole task back must not be refused for a link it didn't make.
    const task = await makeTask(w.admin.agent, proj.id, { linkedTicketId: hidden.id });
    const res = await mgr.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`)
      .send({ title: 'Renamed', linkedTicketId: hidden.id });
    expect(res.status).toBe(200);
    expect(res.body.task.title).toBe('Renamed');
  });

  it('a visible ticket links, and clearing the link with null still works', async () => {
    const task = await makeTask(mgr.agent, proj.id, { linkedTicketId: mine.id });
    expect(task.linkedTicket).toEqual({ id: mine.id, title: 'Visible' });
    const cleared = expectOk(await mgr.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ linkedTicketId: null })).task;
    expect(cleared.linkedTicketId).toBeNull();
    expect(cleared.linkedTicket).toBeNull();
  });
});

describe('tasks, subtasks, codes and rollups', () => {
  let mgr;
  let P;
  let Q;
  let ACTIVE;
  let COMPLETED;
  beforeEach(async () => {
    mgr = await makeManager('mgr', w.deptA.id);
    P = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    Q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptB.id });
    ACTIVE = await projectStatusId(w.admin.agent, 'Active');
    COMPLETED = await projectStatusId(w.admin.agent, 'Completed');
  });
  const taskUrl = (t, p = P) => `${API}/projects/${p.id}/tasks/${t.id}`;
  const patchTask = async (t, body) => expectOk(await mgr.agent.patch(taskUrl(t)).send(body)).task;
  const subUrl = (t, s, p = P) => `${taskUrl(t, p)}/subtasks/${s.id}`;
  const patchSub = async (t, s, body) => expectOk(await mgr.agent.patch(subUrl(t, s)).send(body)).subtask;
  const activity = async (p = P) => expectOk(await w.admin.agent.get(`${API}/projects/${p.id}/activity`)).activity;
  const listTasks = async (p = P) => expectOk(await mgr.agent.get(`${API}/projects/${p.id}/tasks`)).tasks;

  it('creates a task with defaults', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: '  Audit  ' });
    expect(t).toEqual(expect.objectContaining({
      title: 'Audit', taskCode: 'SD-P00001-T01', statusId: ACTIVE, priority: 'medium', position: 1,
      completedAt: null, linkedTicketId: null, createdBy: mgr.user.id, subtasks: [],
    }));
    expect(t.status.name).toBe('Active');
  });

  it('numbers and positions tasks in creation order', async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      made.push(await makeTask(mgr.agent, P.id));
    }
    expect(made.map((t) => [t.taskCode, t.position])).toEqual([
      ['SD-P00001-T01', 1], ['SD-P00001-T02', 2], ['SD-P00001-T03', 3],
    ]);
  });

  it('requires a title', async () => {
    for (const body of [{}, { title: '  ' }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('logs task_created', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'Audit' });
    expect((await activity()).map((a) => [a.action, a.detail])).toContainEqual(
      ['task_created', { taskId: t.id, title: 'Audit', taskCode: 'SD-P00001-T01' }]
    );
  });

  // Likely correct: completedAt stamped at creation. Expected to change in sub-project 3.
  it('[quirk] Q31: a task created already closed has no completedAt', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'x', statusId: COMPLETED });
    expect(t.completedAt).toBeNull();
  });

  it('updates every allowed field', async () => {
    const t = await makeTask(mgr.agent, P.id);
    const changes = {
      title: 'New', description: 'D', priority: 'urgent', assignedToUserId: mgr.user.id, dueDate: '2026-12-01', position: 7,
    };
    expect(await patchTask(t, changes)).toEqual(expect.objectContaining(changes));
  });

  it('closing stamps completedAt and logs task_closed; reopening clears it silently', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'Audit' });
    expect(typeof (await patchTask(t, { statusId: COMPLETED })).completedAt).toBe('string');
    const closed = (await activity()).filter((a) => a.action === 'task_closed');
    expect(closed.map((a) => a.detail)).toEqual([{ taskId: t.id, title: 'Audit', taskCode: 'SD-P00001-T01' }]);
    const before = (await activity()).length;
    expect((await patchTask(t, { statusId: ACTIVE })).completedAt).toBeNull();
    expect((await activity()).length).toBe(before);
  });

  // Likely correct: "3" and 3 are the same status, so nothing changes. Expected to change in sub-project 3.
  it('[quirk] Q7: a string statusId equal to the current one re-stamps completedAt', async () => {
    const t = await makeTask(mgr.agent, P.id);
    await patchTask(t, { statusId: COMPLETED });
    // No endpoint sets completedAt directly; backdate it to see whether it moves.
    await models.ProjectTask.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: t.id } });
    expect((await patchTask(t, { statusId: String(COMPLETED) })).completedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  // Likely correct: one task_closed per real transition. Expected to change in sub-project 3.
  it('[quirk] Q15: re-sending the same closed status logs task_closed again', async () => {
    const t = await makeTask(mgr.agent, P.id);
    await patchTask(t, { statusId: COMPLETED });
    await patchTask(t, { statusId: COMPLETED });
    expect((await activity()).filter((a) => a.action === 'task_closed')).toHaveLength(2);
  });

  it('deletes a task and logs it', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'Audit' });
    expect(expectOk(await mgr.agent.delete(taskUrl(t)))).toEqual({ ok: true });
    expect(await listTasks()).toEqual([]);
    expect((await activity()).map((a) => [a.action, a.detail])).toContainEqual(
      ['task_deleted', { taskId: t.id, title: 'Audit', taskCode: 'SD-P00001-T01' }]
    );
  });

  it('a task from another project is not found through this one', async () => {
    const other = await makeTask(w.admin.agent, Q.id);
    for (const res of [
      await w.admin.agent.patch(`${API}/projects/${P.id}/tasks/${other.id}`).send({ title: 'x' }),
      await w.admin.agent.delete(`${API}/projects/${P.id}/tasks/${other.id}`),
      await w.admin.agent.patch(`${API}/projects/${P.id}/tasks/${other.id}/code`).send({ number: 5 }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Task not found', code: 'NOT_FOUND' });
    }
  });

  describe('reorder', () => {
    let t1;
    let t2;
    let t3;
    beforeEach(async () => {
      t1 = await makeTask(mgr.agent, P.id, { title: 't1' });
      t2 = await makeTask(mgr.agent, P.id, { title: 't2' });
      t3 = await makeTask(mgr.agent, P.id, { title: 't3' });
    });
    const reorder = (order) => mgr.agent.patch(`${API}/projects/${P.id}/tasks/reorder`).send({ order });

    it('reorders tasks', async () => {
      expect(expectOk(await reorder([t3.id, t1.id, t2.id]))).toEqual({ ok: true });
      expect((await listTasks()).map((t) => [t.title, t.position])).toEqual([['t3', 1], ['t1', 2], ['t2', 3]]);
    });

    it('reorder validation', async () => {
      const empty = await reorder([]);
      expect(empty.status).toBe(400);
      expect(empty.body.message).toBe('order must be a non-empty array of task IDs');
      const other = await makeTask(w.admin.agent, Q.id);
      const foreign = await reorder([t1.id, other.id]);
      expect(foreign.status).toBe(400);
      expect(foreign.body.message).toBe('One or more tasks do not belong to this project');
    });

    // Likely correct: the rest are renumbered around the moved task. Expected to change in sub-project 3.
    it('[quirk] Q32: a partial reorder leaves duplicate positions', async () => {
      expectOk(await reorder([t3.id]));
      expect((await listTasks()).map((t) => [t.title, t.position])).toEqual([['t1', 1], ['t3', 1], ['t2', 2]]);
    });
  });

  describe('codes', () => {
    const renumber = (t, number) => mgr.agent.patch(`${taskUrl(t)}/code`).send({ number });

    it('renumbers a task\'s code without moving it', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      await makeTask(mgr.agent, P.id);
      const renumbered = expectOk(await renumber(t1, 5)).task;
      expect(renumbered).toEqual(expect.objectContaining({ taskCode: 'SD-P00001-T05', position: 1 }));
      expect((await makeTask(mgr.agent, P.id)).taskCode).toBe('SD-P00001-T06');
    });

    it('renumber validation', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      for (const number of [0, 100, 'x']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await renumber(t1, number);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: true, message: 'Task number must be between 1 and 99', code: 'VALIDATION_ERROR' });
      }
    });

    it('renumber refuses a taken number but allows its own', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      await makeTask(mgr.agent, P.id);
      const taken = await renumber(t1, 2);
      expect(taken.status).toBe(409);
      expect(taken.body).toEqual({
        error: true, message: 'Task T02 already exists in this project. Choose a different number.', code: 'TASK_CODE_CONFLICT',
      });
      expect((await renumber(t1, 1)).status).toBe(200);
    });

    // Likely correct: subtask codes follow their task's number. Expected to change in sub-project 3.
    it('[quirk] Q20: renumbering a task leaves its subtasks on the old number', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id);
      expectOk(await renumber(t1, 5));
      const s2 = await makeSubtask(mgr.agent, P.id, t1.id);
      expect([s1.subtaskCode, s2.subtaskCode]).toEqual(['SD-P00001-T01-S01', 'SD-P00001-T05-S02']);
    });
  });

  describe('subtasks', () => {
    let t1;
    beforeEach(async () => {
      t1 = await makeTask(mgr.agent, P.id);
    });

    it('creates a subtask with defaults', async () => {
      const s = await makeSubtask(mgr.agent, P.id, t1.id, { title: '  Cable  ' });
      expect(s).toEqual(expect.objectContaining({
        title: 'Cable', subtaskCode: 'SD-P00001-T01-S01', statusId: ACTIVE, position: 1, completedAt: null,
      }));
    });

    it('requires a subtask title', async () => {
      const res = await mgr.agent.post(`${taskUrl(t1)}/subtasks`).send({ title: ' ' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'Subtask title is required', code: 'VALIDATION_ERROR' });
    });

    it('a subtask can\'t be created under another project\'s task', async () => {
      const other = await makeTask(w.admin.agent, Q.id);
      const res = await w.admin.agent.post(`${API}/projects/${P.id}/tasks/${other.id}/subtasks`).send({ title: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Task not found');
    });

    it('closing a subtask stamps completedAt and logs once', async () => {
      const s = await makeSubtask(mgr.agent, P.id, t1.id, { title: 'Cable' });
      expect(typeof (await patchSub(t1, s, { statusId: COMPLETED })).completedAt).toBe('string');
      await patchSub(t1, s, { statusId: COMPLETED });
      const closed = (await activity()).filter((a) => a.action === 'subtask_closed');
      expect(closed.map((a) => a.detail)).toEqual([{ subtaskId: s.id, title: 'Cable', subtaskCode: 'SD-P00001-T01-S01' }]);
      expect((await patchSub(t1, s, { statusId: ACTIVE })).completedAt).toBeNull();
    });

    // Likely correct: "3" and 3 are the same status. Expected to change in sub-project 3.
    it('[quirk] Q7: same for a subtask', async () => {
      const s = await makeSubtask(mgr.agent, P.id, t1.id);
      await patchSub(t1, s, { statusId: COMPLETED });
      // No endpoint sets completedAt directly; backdate it to see whether it moves.
      await models.ProjectSubtask.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: s.id } });
      expect((await patchSub(t1, s, { statusId: String(COMPLETED) })).completedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('subtask routes check both parents', async () => {
      const t2 = await makeTask(mgr.agent, P.id);
      const s2 = await makeSubtask(mgr.agent, P.id, t2.id);
      for (const res of [
        await mgr.agent.patch(subUrl(t1, s2)).send({ title: 'x' }),
        await mgr.agent.patch(`${subUrl(t1, s2)}/code`).send({ number: 5 }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Subtask not found');
      }
      const qt = await makeTask(w.admin.agent, Q.id);
      const qs = await makeSubtask(w.admin.agent, Q.id, qt.id);
      for (const res of [
        await w.admin.agent.patch(`${API}/projects/${P.id}/tasks/${qt.id}/subtasks/${qs.id}`).send({ title: 'x' }),
        await w.admin.agent.patch(`${API}/projects/${P.id}/tasks/${qt.id}/subtasks/${qs.id}/code`).send({ number: 5 }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Task not found');
      }
    });

    it('renumbers a subtask', async () => {
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id);
      await makeSubtask(mgr.agent, P.id, t1.id);
      const code = (s, number) => mgr.agent.patch(`${subUrl(t1, s)}/code`).send({ number });
      expect(expectOk(await code(s1, 5)).subtask.subtaskCode).toBe('SD-P00001-T01-S05');
      const taken = await code(s1, 2);
      expect(taken.status).toBe(409);
      expect(taken.body).toEqual({
        error: true, message: 'Subtask S02 already exists in this task. Choose a different number.', code: 'SUBTASK_CODE_CONFLICT',
      });
    });

    it('subtask renumber validation', async () => {
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id);
      const res = await mgr.agent.patch(`${subUrl(t1, s1)}/code`).send({ number: 0 });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Subtask number must be between 1 and 99');
    });
  });

  describe('completion rollups', () => {
    it('a task with subtasks is complete when all its subtasks are closed', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      await makeSubtask(mgr.agent, P.id, t1.id, { statusId: COMPLETED });
      const s2 = await makeSubtask(mgr.agent, P.id, t1.id);
      expect((await listTasks())[0]).toEqual(expect.objectContaining({ isComplete: false, subtaskPercent: 50 }));
      await patchSub(t1, s2, { statusId: COMPLETED });
      expect((await listTasks())[0]).toEqual(expect.objectContaining({ isComplete: true, subtaskPercent: 100, statusId: ACTIVE }));
    });

    it('a task without subtasks is complete when its own status is closed', async () => {
      await makeTask(mgr.agent, P.id, { statusId: COMPLETED });
      expect((await listTasks())[0]).toEqual(expect.objectContaining({ isComplete: true, subtaskPercent: null }));
    });

    it('project completion is the rounded share of complete tasks', async () => {
      await makeTask(mgr.agent, P.id, { statusId: COMPLETED });
      await makeTask(mgr.agent, P.id);
      await makeTask(mgr.agent, P.id);
      expect(expectOk(await mgr.agent.get(`${API}/projects/${P.id}`)).project.stats)
        .toEqual(expect.objectContaining({ completionPercent: 33, totalTasks: 3, closedTasks: 1 }));
    });
  });

  it('scope applies to every task route', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    for (const res of [
      await own.agent.get(`${API}/projects/${P.id}/tasks`),
      await own.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'x' }),
      await mgr.agent.get(`${API}/projects/${Q.id}/tasks`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have access to this project');
    }
  });

  it('non-numeric ids are 404s', async () => {
    expect((await mgr.agent.get(`${API}/projects/abc/tasks`)).status).toBe(404);
    expect((await mgr.agent.patch(`${API}/projects/${P.id}/tasks/xyz`).send({ title: 'x' })).status).toBe(404);
  });

  // Likely correct: a linked ticket the viewer can't open is hidden or redacted. Expected to change in sub-project 3.
  it('[quirk] Q19: task lists show a linked ticket the viewer can\'t open', async () => {
    const secret = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
    await makeTask(w.admin.agent, P.id, { linkedTicketId: secret.id });
    expect((await listTasks())[0].linkedTicket).toEqual({ id: secret.id, title: 'Secret' });
  });
});
