const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeManager, makeTicket, makeProject, makeTask,
} = require('./fixtures');

// Plan 3c: what the screens need from the API — whether the viewer may edit,
// moderate and delete a ticket or project, and the time logged per task.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('a ticket says what the viewer may do with it', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  const tech = await makeTech('tech', w.deptA.id);
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  const access = async (u) => expectOk(await u.agent.get(`${API}/tickets/${t.id}`)).ticket.access;
  expect(await access(staff)).toEqual({ edit: false, moderate: false, delete: false, canTake: false });
  // canTake (5b): the ticket is unassigned, and edit access is enough to take it.
  expect(await access(tech)).toEqual({ edit: true, moderate: false, delete: false, canTake: true });
  expect(await access(w.admin)).toEqual({ edit: true, moderate: true, delete: true, canTake: true });
  const patched = expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'low' })).ticket;
  expect(patched.access).toEqual({ edit: true, moderate: true, delete: true, canTake: true });
  const created = expectOk(await tech.agent.post(`${API}/tickets`).send({ title: 'New', contactId: w.contact.id }), 201).ticket;
  expect(created.access.edit).toBe(true);
});

it('a project says what the viewer may do with it', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  const mgr = await makeManager('mgr', w.deptA.id);
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  const access = async (u) => expectOk(await u.agent.get(`${API}/projects/${p.id}`)).project.access;
  expect(await access(staff)).toEqual({ edit: false, moderate: false, delete: false });
  expect(await access(mgr)).toEqual({ edit: true, moderate: true, delete: false });
  expect(expectOk(await w.admin.agent.patch(`${API}/projects/${p.id}`).send({ name: 'Q' })).project.access)
    .toEqual({ edit: true, moderate: true, delete: true });
});

it('tasks carry the time logged on them, a task including its subtasks', async () => {
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  const task = await makeTask(w.admin.agent, p.id, { title: 'Parent' });
  const sub = expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/tasks`).send({ title: 'Child', parentTaskId: task.id }), 201).task;
  const log = (body) => w.admin.agent.post(`${API}/projects/${p.id}/time-entries`).send({ durationMinutes: 30, ...body });
  expectOk(await log({ taskId: task.id }), 201);
  expectOk(await log({ taskId: sub.id }), 201);
  expectOk(await log({}), 201);
  const [listed] = expectOk(await w.admin.agent.get(`${API}/projects/${p.id}/tasks`)).tasks;
  expect([listed.loggedSeconds, listed.subtasks[0].loggedSeconds]).toEqual([3600, 1800]);
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  const tt = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'x' }), 201).task;
  expect(tt.loggedSeconds).toBe(0);
});
