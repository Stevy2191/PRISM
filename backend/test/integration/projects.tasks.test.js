const { resetData, closeDb } = require('./helpers');
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
