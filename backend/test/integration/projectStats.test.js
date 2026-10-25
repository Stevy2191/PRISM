const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, taskStatusId,
} = require('./fixtures');

// The project page's summary row (sub-project 6, task 5): stats gained the
// task, hour, milestone and waiting figures.

let w;
let proj;
let DONE;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  proj = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  DONE = await taskStatusId(w.admin.agent, 'project', 'Completed');
});
afterAll(closeDb);

const a = () => w.admin.agent;
const taskUrl = (t) => `${API}/projects/${proj.id}/tasks/${t.id}`;
const stats = async () => expectOk(await a().get(`${API}/projects/${proj.id}/stats`)).stats;
const milestone = async (title, dueDate) => {
  const t = await makeTask(a(), proj.id, { title });
  expectOk(await a().patch(taskUrl(t)).send({ isMilestone: true, dueDate }));
  return t;
};

describe('stats for the summary row', () => {
  it('counts tasks done and total, minutes logged and the hour budget', async () => {
    expect(await stats()).toEqual(expect.objectContaining({
      tasksDone: 0, tasksTotal: 0, loggedMinutes: 0, hourBudgetMinutes: null, nextMilestone: null, waitingCount: 0,
    }));
    const t = await makeTask(a(), proj.id, { title: 'One' });
    await makeTask(a(), proj.id, { title: 'Two' });
    expectOk(await a().patch(taskUrl(t)).send({ statusId: DONE }));
    expectOk(await a().post(`${API}/projects/${proj.id}/time-entries`).send({ entryDate: '2026-03-03', durationMinutes: 90 }), 201);
    // The project budget is set by the budget task's API; here set the column.
    await models.Project.update({ hourBudgetMinutes: 600 }, { where: { id: proj.id } });
    expect(await stats()).toEqual(expect.objectContaining({
      tasksDone: 1, tasksTotal: 2, loggedMinutes: 90, hourBudgetMinutes: 600,
    }));
    expect(expectOk(await a().get(`${API}/projects/${proj.id}`)).project.stats.tasksTotal).toBe(2);
  });

  it('stats nextMilestone is the earliest open milestone', async () => {
    const late = await milestone('Sign-off', '2026-05-01');
    const early = await milestone('Cutover', '2026-04-10');
    const done = await milestone('Kick-off', '2026-03-01');
    expectOk(await a().patch(taskUrl(done)).send({ statusId: DONE }));
    expect((await stats()).nextMilestone).toEqual({
      id: early.id, code: expect.any(String), title: 'Cutover', dueDate: '2026-04-10',
    });
    expectOk(await a().patch(taskUrl(early)).send({ statusId: DONE }));
    expect((await stats()).nextMilestone).toEqual(expect.objectContaining({ id: late.id, dueDate: '2026-05-01' }));
    expectOk(await a().patch(taskUrl(late)).send({ statusId: DONE }));
    expect((await stats()).nextMilestone).toBeNull();
  });

  it('waitingCount counts waiting open tasks', async () => {
    const first = await makeTask(a(), proj.id, { title: 'First' });
    const second = await makeTask(a(), proj.id, { title: 'Second' });
    const third = await makeTask(a(), proj.id, { title: 'Third' });
    const link = (p, s) => a().post(`${API}/projects/${proj.id}/dependencies`).send({ predecessorId: p.id, successorId: s.id });
    expect((await link(first, second)).status).toBe(201);
    expect((await link(first, third)).status).toBe(201);
    expect((await stats()).waitingCount).toBe(2);
    // A done task is not waiting, and finishing the predecessor unblocks.
    expectOk(await a().patch(taskUrl(third)).send({ statusId: DONE }));
    expect((await stats()).waitingCount).toBe(1);
    expectOk(await a().patch(taskUrl(first)).send({ statusId: DONE }));
    expect((await stats()).waitingCount).toBe(0);
  });
});
