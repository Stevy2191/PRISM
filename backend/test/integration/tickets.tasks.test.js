const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, taskStatusId, freezeClock, unfreezeClock,
} = require('./fixtures');

// Ticket tasks are real tasks now (sub-project 3): statuses, subtasks, codes,
// reorder and renumber, the same service as project tasks.

let w;
let tech;
let ticket;
let TODO;
let DONE;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Onboard', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
  TODO = await taskStatusId(w.admin.agent, 'ticket', 'To do');
  DONE = await taskStatusId(w.admin.agent, 'ticket', 'Done');
});
afterEach(unfreezeClock);
afterAll(closeDb);

const tasksUrl = (t = ticket) => `${API}/tickets/${t.id}/tasks`;
const create = async (body, agent = tech.agent, t = ticket) => expectOk(await agent.post(tasksUrl(t)).send(body), 201).task;
const patch = async (task, body) => expectOk(await tech.agent.patch(`${tasksUrl()}/${task.id}`).send(body)).task;
const pad = () => String(ticket.id).padStart(5, '0');
const activity = async () => expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`)).activity;

it('creates a task, trimmed, in To do, with a code and an assignee', async () => {
  const task = await create({ title: '  Swap toner  ', assigneeId: tech.user.id });
  expect(task).toEqual(expect.objectContaining({
    ticketId: ticket.id, projectId: null, title: 'Swap toner', statusId: TODO, code: `#${pad()}-T01`,
    assigneeId: tech.user.id, completedAt: null, position: 1, subtasks: [],
  }));
  expect(task.status.name).toBe('To do');
  expect(task.assignee.username).toBe('tech');
});

it('requires a title', async () => {
  for (const body of [{}, { title: '   ' }, { description: 'old field name' }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await tech.agent.post(tasksUrl()).send(body);
    expect(res.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
  }
});

it('lists tasks in order, with subtasks nested', async () => {
  freezeClock('2026-03-11T17:00:00Z');
  const fresh = await makeTech('frozen', w.deptA.id);
  const one = await create({ title: 'one' }, fresh.agent);
  const two = await create({ title: 'two' }, fresh.agent);
  const sub = await create({ title: 'one.a', parentTaskId: one.id }, fresh.agent);
  expect(sub.code).toBe(`#${pad()}-T01-S01`);
  const { tasks } = expectOk(await tech.agent.get(tasksUrl()));
  expect(tasks.map((t) => [t.id, t.subtasks.map((s) => s.id)])).toEqual([[one.id, [sub.id]], [two.id, []]]);
});

it('completes and reopens by status', async () => {
  const task = await create({ title: 'x' });
  const done = await patch(task, { statusId: DONE });
  expect([done.status.name, typeof done.completedAt]).toEqual(['Done', 'string']);
  expect((await patch(task, { statusId: TODO })).completedAt).toBeNull();
});

it('refuses a project-scope status', async () => {
  const projectActive = await taskStatusId(w.admin.agent, 'project', 'Active');
  const res = await tech.agent.post(tasksUrl()).send({ title: 'x', statusId: projectActive });
  expect(res.body).toEqual({ error: true, message: 'Unknown task status', code: 'VALIDATION_ERROR' });
});

it('reassigns and unassigns', async () => {
  const task = await create({ title: 'x', assigneeId: tech.user.id });
  expect((await patch(task, { assigneeId: w.admin.user.id })).assigneeId).toBe(w.admin.user.id);
  expect((await patch(task, { assigneeId: null })).assigneeId).toBeNull();
  await patch(task, { assigneeId: tech.user.id });
  expect((await patch(task, { assigneeId: '' })).assigneeId).toBeNull();
});

it('Q38: edits the title, and refuses a blank one', async () => {
  const task = await create({ title: 'old' });
  expect((await patch(task, { title: ' New ' })).title).toBe('New');
  const res = await tech.agent.patch(`${tasksUrl()}/${task.id}`).send({ title: '  ' });
  expect(res.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
});

it('ticket tasks can\'t link a ticket', async () => {
  const res = await tech.agent.post(tasksUrl()).send({ title: 'x', linkedTicketId: ticket.id });
  expect(res.body).toEqual({ error: true, message: 'Only project tasks can link a ticket', code: 'VALIDATION_ERROR' });
});

it('reorders, renumbers and deletes', async () => {
  const a = await create({ title: 'a' });
  const b = await create({ title: 'b' });
  expectOk(await tech.agent.patch(`${tasksUrl()}/reorder`).send({ order: [b.id, a.id] }));
  expect(expectOk(await tech.agent.get(tasksUrl())).tasks.map((t) => t.title)).toEqual(['b', 'a']);
  const partial = await tech.agent.patch(`${tasksUrl()}/reorder`).send({ order: [a.id] });
  expect(partial.body.message).toBe('order must list every task at this level exactly once');
  expect(expectOk(await tech.agent.patch(`${tasksUrl()}/${a.id}/code`).send({ number: 7 })).task.code).toBe(`#${pad()}-T07`);
  expectOk(await tech.agent.delete(`${tasksUrl()}/${b.id}`));
  expect(expectOk(await tech.agent.get(tasksUrl())).tasks.map((t) => t.title)).toEqual(['a']);
});

it('a task from another ticket is not found through this one', async () => {
  const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
  const other = await create({ title: 'elsewhere' }, w.admin.agent, t2);
  for (const res of [
    await tech.agent.patch(`${tasksUrl()}/${other.id}`).send({ statusId: DONE }),
    await tech.agent.delete(`${tasksUrl()}/${other.id}`),
    await tech.agent.patch(`${tasksUrl()}/${other.id}/code`).send({ number: 3 }),
  ]) {
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Task not found', code: 'NOT_FOUND' });
  }
});

it('own-tier users can\'t touch tasks on others\' tickets', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  const task = await create({ title: 'x' });
  for (const res of [
    await own.agent.get(tasksUrl()),
    await own.agent.post(tasksUrl()).send({ title: 'y' }),
    await own.agent.patch(`${tasksUrl()}/${task.id}`).send({ statusId: DONE }),
  ]) {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this ticket');
  }
});

it('tasks of a missing ticket', async () => {
  const res = await tech.agent.get(`${API}/tickets/99999/tasks`);
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('Ticket not found');
});

it('Q8: creating and completing a task writes activity and audit rows', async () => {
  const task = await create({ title: 'Image laptop' });
  await patch(task, { statusId: DONE });
  const acts = (await activity()).map((a) => [a.action, a.toValue]);
  expect(acts).toContainEqual(['task_created', `#${pad()}-T01 Image laptop`]);
  expect(acts).toContainEqual(['task_closed', `#${pad()}-T01 Image laptop`]);
  expect(await models.AuditLog.count({ where: { entityType: 'Task' } })).toBe(2);
});
