const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, taskStatusId } = require('./fixtures');
const request = require('supertest');
const { getApp } = require('./helpers');

// The read-only lists task and time forms need: task statuses per scope and
// work types (seeded by the one-work-model migration).

let w;
beforeAll(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('lists the ticket-task statuses in order', async () => {
  const { statuses } = expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=ticket`));
  expect(statuses.map((s) => [s.name, s.behaviorType, s.isDefault, s.isProtected])).toEqual([
    ['To do', 'open', true, false], ['In progress', 'open', false, false], ['Done', 'closed', false, true],
  ]);
  expect(await taskStatusId(w.admin.agent, 'ticket', 'Done')).toBe(statuses[2].id);
});

it('the project scope mirrors the project statuses, ids included', async () => {
  const { statuses } = expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=project`));
  const projectStatuses = expectOk(await w.admin.agent.get(`${API}/project-statuses`)).statuses;
  expect(statuses.map((s) => [s.id, s.name, s.behaviorType])).toEqual(projectStatuses.map((s) => [s.id, s.name, s.behaviorType]));
});

it('lists every scope without a filter, and refuses an unknown one', async () => {
  const all = expectOk(await w.admin.agent.get(`${API}/task-statuses`)).statuses;
  expect(new Set(all.map((s) => s.scope))).toEqual(new Set(['ticket', 'project']));
  const bad = await w.admin.agent.get(`${API}/task-statuses?scope=asset`);
  expect(bad.status).toBe(400);
  expect(bad.body).toEqual({ error: true, message: 'scope must be ticket or project', code: 'VALIDATION_ERROR' });
});

it('lists the work types', async () => {
  const { workTypes } = expectOk(await w.admin.agent.get(`${API}/work-types`));
  expect(workTypes.map((t) => [t.name, t.billableDefault, t.isActive])).toEqual([
    ['Remote support', true, true], ['On-site', true, true], ['Travel', true, true],
    ['Project work', true, true], ['Admin', false, true],
  ]);
});

it('both lists need a login', async () => {
  for (const path of ['task-statuses', 'work-types']) {
    // eslint-disable-next-line no-await-in-loop
    expect((await request(getApp()).get(`${API}/${path}`)).status).toBe(401);
  }
});

it('the new models load with their associations', () => {
  const { Task, TimeEntry } = models;
  expect(Object.keys(Task.associations).sort()).toEqual(
    ['assignee', 'creator', 'linkedTicket', 'parentTask', 'project', 'status', 'subtasks', 'ticket']
  );
  expect(Object.keys(TimeEntry.associations).sort()).toEqual(['loggedBy', 'project', 'task', 'ticket', 'user', 'workType']);
  expect(models.TicketTask).toBeUndefined();
  expect(models.ProjectTimeEntry).toBeUndefined();
});
