const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, makeStaff,
} = require('./fixtures');

// GET /projects/:id/activity?taskId= narrows the feed to one task.

let w;
let P;
let Q;
let a;
let b;
beforeAll(async () => {
  await resetData();
  w = await makeWorld();
  P = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  Q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
  a = await makeTask(w.admin.agent, P.id, { title: 'A' });
  b = await makeTask(w.admin.agent, P.id, { title: 'B' });
  expectOk(await w.admin.agent.patch(`${API}/projects/${P.id}/tasks/${a.id}`).send({ title: 'A2' }));
});
afterAll(closeDb);

const feed = (agent, project, query = '') => agent.get(`${API}/projects/${project.id}/activity${query}`);

it('taskId returns only that task\'s activity', async () => {
  const all = expectOk(await feed(w.admin.agent, P)).activity;
  const one = expectOk(await feed(w.admin.agent, P, `?taskId=${a.id}`)).activity;
  expect(one.length).toBeGreaterThan(0);
  expect(one.every((r) => r.detail.taskId === a.id)).toBe(true);
  expect(all.length).toBeGreaterThan(one.length); // B's creation is in the full feed only
  expect(one.map((r) => r.action)).toEqual(expect.arrayContaining(['task_created', 'task_updated']));
});

it('a task of another project, a missing or a malformed id is a 404', async () => {
  const other = await makeTask(w.admin.agent, Q.id, { title: 'Other' });
  for (const id of [other.id, 999999, 'abc', '12abc']) {
    expect((await feed(w.admin.agent, P, `?taskId=${id}`)).status).toBe(404);
  }
});

it('the project access check still applies', async () => {
  const outsider = await makeStaff('outsider', w.deptB.id);
  expect((await feed(outsider.agent, P, `?taskId=${b.id}`)).status).toBe(403);
});
