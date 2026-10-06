const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeOwnTier, makeTicket, makeProject, makeTask,
  makeSubtask, taskStatusId, makeCompany, setCompanyAccess, freezeClock, advanceClock, unfreezeClock,
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

  // MariaDB converts a raw value differently from parseInt: "1e1" becomes 10
  // and 1.6 rounds to 2. An id that is not a plain positive integer must be
  // refused outright, never checked as one ticket and stored as another.
  it.each([[1.6], ['1.6'], [1.5], ['1e1'], ['1x'], [-1], [true]])(
    'refuses a linkedTicketId that is not a plain integer (%p)',
    async (bad) => {
      const created = await mgr.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', linkedTicketId: bad });
      expect(created.status).toBe(400);
      expect(created.body).toEqual(refused);
      const task = await makeTask(mgr.agent, proj.id, { linkedTicketId: mine.id });
      const patched = await mgr.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ linkedTicketId: bad });
      expect(patched.status).toBe(400);
      expect(patched.body).toEqual(refused);
      const tasks = expectOk(await mgr.agent.get(`${API}/projects/${proj.id}/tasks`)).tasks;
      expect(tasks.map((t) => t.linkedTicketId)).toEqual([mine.id]);
    }
  );

  it('accepts a visible ticket id sent as a numeric string, and stores the number', async () => {
    const task = await makeTask(mgr.agent, proj.id, { linkedTicketId: String(mine.id) });
    expect(task.linkedTicketId).toBe(mine.id);
    expect(task.linkedTicket).toEqual({ id: mine.id, title: 'Visible' });
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
    ACTIVE = await taskStatusId(w.admin.agent, 'project', 'Active');
    COMPLETED = await taskStatusId(w.admin.agent, 'project', 'Completed');
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
      title: 'Audit', code: 'SD-P00001-T01', statusId: ACTIVE, priority: 'medium', position: 1, projectId: P.id,
      ticketId: null, parentTaskId: null, estimateMinutes: null, completedAt: null, linkedTicketId: null,
      createdBy: mgr.user.id, subtasks: [],
    }));
    expect(t.status.name).toBe('Active');
  });

  it('Q31: a task created already closed gets completedAt', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'x', statusId: COMPLETED });
    expect(typeof t.completedAt).toBe('string');
  });

  it('updates every editable field', async () => {
    const t = await makeTask(mgr.agent, P.id);
    const changes = {
      title: 'New', description: 'D', priority: 'urgent', assigneeId: mgr.user.id, dueDate: '2026-12-01', estimateMinutes: 90,
    };
    expect(await patchTask(t, changes)).toEqual(expect.objectContaining(changes));
  });

  it('position is changed by reorder only', async () => {
    const t = await makeTask(mgr.agent, P.id);
    expect((await patchTask(t, { position: 7 })).position).toBe(1);
  });

  it('Q38: task and subtask updates refuse a blank or whitespace title', async () => {
    const t = await makeTask(mgr.agent, P.id);
    const s = await makeSubtask(mgr.agent, P.id, t.id);
    for (const title of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop
      const taskRes = await mgr.agent.patch(taskUrl(t)).send({ title });
      expect(taskRes.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
      // eslint-disable-next-line no-await-in-loop
      const subRes = await mgr.agent.patch(subUrl(t, s)).send({ title });
      expect(subRes.body).toEqual({ error: true, message: 'Subtask title is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('closing stamps completedAt and logs task_closed; reopening clears it and logs task_reopened', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'Audit' });
    expect(typeof (await patchTask(t, { statusId: COMPLETED })).completedAt).toBe('string');
    expect((await patchTask(t, { statusId: ACTIVE })).completedAt).toBeNull();
    const detail = { taskId: t.id, title: 'Audit', taskCode: 'SD-P00001-T01' };
    const acts = (await activity()).map((a) => [a.action, a.detail]);
    expect(acts).toContainEqual(['task_closed', detail]);
    expect(acts).toContainEqual(['task_reopened', detail]);
  });

  it('Q7: a string statusId equal to the current one changes nothing', async () => {
    const t = await makeTask(mgr.agent, P.id);
    await patchTask(t, { statusId: COMPLETED });
    await models.Task.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: t.id } });
    expect((await patchTask(t, { statusId: String(COMPLETED) })).completedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('Q15: re-sending the same closed status logs task_closed once', async () => {
    const t = await makeTask(mgr.agent, P.id);
    await patchTask(t, { statusId: COMPLETED });
    await patchTask(t, { statusId: COMPLETED });
    expect((await activity()).filter((a) => a.action === 'task_closed')).toHaveLength(1);
  });

  it('numbers and positions tasks in creation order', async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      made.push(await makeTask(mgr.agent, P.id));
    }
    expect(made.map((t) => [t.code, t.position])).toEqual([
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

    it('Q32: a reorder must list every task at its level, once', async () => {
      for (const order of [[t3.id], [t1.id, t2.id, t2.id], [t1.id, t2.id, t3.id, t3.id]]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await reorder(order);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('order must list every task at this level exactly once');
      }
      expect((await listTasks()).map((t) => [t.title, t.position])).toEqual([['t1', 1], ['t2', 2], ['t3', 3]]);
    });

    it('reorders subtasks within their task', async () => {
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id, { title: 's1' });
      const s2 = await makeSubtask(mgr.agent, P.id, t1.id, { title: 's2' });
      expectOk(await mgr.agent.patch(`${API}/projects/${P.id}/tasks/reorder`).send({ parentTaskId: t1.id, order: [s2.id, s1.id] }));
      expect((await listTasks())[0].subtasks.map((s) => s.title)).toEqual(['s2', 's1']);
    });

  });

  describe('codes', () => {
    const renumber = (t, number) => mgr.agent.patch(`${taskUrl(t)}/code`).send({ number });

    it('renumbers a task\'s code without moving it', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      await makeTask(mgr.agent, P.id);
      const renumbered = expectOk(await renumber(t1, 5)).task;
      expect(renumbered).toEqual(expect.objectContaining({ code: 'SD-P00001-T05', position: 1 }));
      expect((await makeTask(mgr.agent, P.id)).code).toBe('SD-P00001-T06');
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

    it('Q20: renumbering a task renumbers its subtasks', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id);
      expectOk(await renumber(t1, 5));
      const s2 = await makeSubtask(mgr.agent, P.id, t1.id);
      const [fresh] = await listTasks();
      expect(fresh.subtasks.map((s) => [s.id, s.code])).toEqual([[s1.id, 'SD-P00001-T05-S01'], [s2.id, 'SD-P00001-T05-S02']]);
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
        title: 'Cable', code: 'SD-P00001-T01-S01', statusId: ACTIVE, position: 1, completedAt: null, parentTaskId: t1.id,
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

    it('Q7: same for a subtask', async () => {
      const s = await makeSubtask(mgr.agent, P.id, t1.id);
      await patchSub(t1, s, { statusId: COMPLETED });
      await models.Task.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: s.id } });
      expect((await patchSub(t1, s, { statusId: String(COMPLETED) })).completedAt).toBe('2026-01-01T00:00:00.000Z');
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
      expect(expectOk(await code(s1, 5)).subtask.code).toBe('SD-P00001-T01-S05');
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

  describe('the unified rules', () => {
    it('Q25: a status from the other scope, a missing one, or a non-integer id is refused', async () => {
      const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
      const t = await makeTask(mgr.agent, P.id);
      for (const statusId of [done, 99999, '1abc', 1.5]) {
        // eslint-disable-next-line no-await-in-loop
        const created = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'x', statusId });
        expect(created.body).toEqual({ error: true, message: 'Unknown task status', code: 'VALIDATION_ERROR' });
        // eslint-disable-next-line no-await-in-loop
        const patched = await mgr.agent.patch(taskUrl(t)).send({ statusId });
        expect(patched.body).toEqual({ error: true, message: 'Unknown task status', code: 'VALIDATION_ERROR' });
      }
    });

    it('validates priority, due date and estimate', async () => {
      const t = await makeTask(mgr.agent, P.id);
      const cases = [
        [{ priority: 'critical' }, 'Invalid priority'],
        [{ dueDate: 'tomorrow' }, 'Invalid due date'],
        [{ estimateMinutes: -5 }, 'Estimate must be a whole number of minutes'],
        [{ estimateMinutes: 1.5 }, 'Estimate must be a whole number of minutes'],
      ];
      for (const [body, message] of cases) {
        // eslint-disable-next-line no-await-in-loop
        const res = await mgr.agent.patch(taskUrl(t)).send(body);
        expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
      }
      expect((await patchTask(t, { estimateMinutes: null, dueDate: null })).estimateMinutes).toBeNull();
    });

    it('a subtask is a task with parentTaskId, one level deep', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s = expectOk(await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'Sub', parentTaskId: t1.id }), 201).task;
      expect([s.parentTaskId, s.code]).toEqual([t1.id, 'SD-P00001-T01-S01']);
      const deeper = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'Deeper', parentTaskId: s.id });
      expect(deeper.body).toEqual({ error: true, message: "Subtasks can't have subtasks", code: 'VALIDATION_ERROR' });
      const other = await makeTask(w.admin.agent, Q.id);
      for (const parentTaskId of [other.id, 99999, '1abc']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'x', parentTaskId });
        expect(res.body).toEqual({ error: true, message: 'Parent task not found', code: 'VALIDATION_ERROR' });
      }
      // The same subtask is reachable by its own task URL.
      expect(expectOk(await mgr.agent.patch(taskUrl(s)).send({ title: 'Sub 2' })).task.title).toBe('Sub 2');
    });

    it('lists by position, then id, under a frozen clock', async () => {
      freezeClock('2026-03-11T17:00:00Z');
      const fresh = await makeManager('frozen', w.deptA.id);
      const ids = [];
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        ids.push((await makeTask(fresh.agent, P.id)).id);
      }
      const listed = expectOk(await fresh.agent.get(`${API}/projects/${P.id}/tasks`)).tasks;
      expect(listed.map((t) => t.id)).toEqual(ids);
    });

    it('deleting a task keeps its time and a running timer, on no task', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s = await makeSubtask(mgr.agent, P.id, t1.id);
      const { WorkType, TimeEntry, ActiveTimer } = models;
      const wt = await WorkType.findOne({ where: { name: 'Project work' } });
      const entry = await TimeEntry.create({
        projectId: P.id, taskId: s.id, userId: mgr.user.id, loggedById: mgr.user.id, entryDate: '2026-03-10',
        durationSeconds: 600, billable: true, workTypeId: wt.id,
      });
      await ActiveTimer.create({ userId: mgr.user.id, entityType: 'project', entityId: P.id, taskId: t1.id, startedAt: new Date() });
      expectOk(await mgr.agent.delete(taskUrl(t1)));
      expect((await TimeEntry.findByPk(entry.id)).taskId).toBeNull();
      expect((await ActiveTimer.findOne({ where: { userId: mgr.user.id } })).taskId).toBeNull();
      expect(await models.Task.count({ where: { projectId: P.id } })).toBe(0);
    });

    it('Q23: task create, edit, status change, reorder, renumber and delete are audited', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const t2 = await makeTask(mgr.agent, P.id);
      await patchTask(t1, { title: 'Renamed' });
      await patchTask(t1, { statusId: COMPLETED });
      expectOk(await mgr.agent.patch(`${API}/projects/${P.id}/tasks/reorder`).send({ order: [t2.id, t1.id] }));
      expectOk(await mgr.agent.patch(`${taskUrl(t1)}/code`).send({ number: 9 }));
      expectOk(await mgr.agent.delete(taskUrl(t2)));
      const rows = await models.AuditLog.findAll({ where: { entityType: 'Task' }, order: [['id', 'ASC']] });
      expect(rows.map((r) => r.action)).toEqual([
        'task.create', 'task.create', 'task.update', 'task.update', 'task.reorder', 'task.renumber', 'task.delete',
      ]);
    });

    it('an assignee must reach the project\'s company', async () => {
      const acme = await makeCompany(w.admin, { name: 'Acme' });
      const acmeProject = await makeProject(w.admin.agent, { name: 'Acme job', companyId: acme.id, ownerDepartmentId: w.deptA.id });
      const fenced = await makeTech('fenced', w.deptA.id);
      const internalId = (await models.Company.findOne({ where: { isInternal: true } })).id;
      await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
      const res = await w.admin.agent.post(`${API}/projects/${acmeProject.id}/tasks`).send({ title: 'x', assigneeId: fenced.user.id });
      expect(res.body).toEqual({ error: true, message: "Assignee can't see projects for this company", code: 'VALIDATION_ERROR' });
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
