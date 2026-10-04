const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Baseline for the per-ticket task checklist. Sub-project 3 gives these
// tasks subtasks and time; this pins what they do before that.

let w;
let tech;
let ticket;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Onboard', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const tasksUrl = (t = ticket) => `${API}/tickets/${t.id}/tasks`;
const create = async (body, agent = tech.agent, t = ticket) => expectOk(await agent.post(tasksUrl(t)).send(body), 201).task;
const patch = async (task, body) => expectOk(await tech.agent.patch(`${tasksUrl()}/${task.id}`).send(body)).task;

it('creates a task, trimmed, with an assignee', async () => {
  const task = await create({ description: '  Swap toner  ', assigneeId: tech.user.id });
  expect(task).toEqual(expect.objectContaining({
    ticketId: ticket.id, description: 'Swap toner', completed: false, assigneeId: tech.user.id,
  }));
  expect(task.assignee.username).toBe('tech');
});

it('requires a description', async () => {
  for (const body of [{}, { description: '   ' }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await tech.agent.post(tasksUrl()).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'Task description is required', code: 'VALIDATION_ERROR' });
  }
});

it('lists tasks oldest first', async () => {
  freezeClock('2026-03-11T17:00:00Z');
  const ids = [];
  for (const description of ['one', 'two', 'three']) {
    // eslint-disable-next-line no-await-in-loop
    ids.push((await create({ description })).id);
    advanceClock(1000);
  }
  expect(expectOk(await tech.agent.get(tasksUrl())).tasks.map((t) => t.id)).toEqual(ids);
});

it('toggles completed using truthiness', async () => {
  const task = await create({ description: 'x' });
  expect((await patch(task, { completed: true })).completed).toBe(true);
  expect((await patch(task, { completed: 0 })).completed).toBe(false);
  expect((await patch(task, { completed: 'yes' })).completed).toBe(true);
});

it('reassigns and unassigns', async () => {
  const task = await create({ description: 'x', assigneeId: tech.user.id });
  expect((await patch(task, { assigneeId: w.admin.user.id })).assigneeId).toBe(w.admin.user.id);
  expect((await patch(task, { assigneeId: null })).assigneeId).toBeNull();
  await patch(task, { assigneeId: tech.user.id });
  expect((await patch(task, { assigneeId: '' })).assigneeId).toBeNull();
});

it('edits the description and ignores a blank one', async () => {
  const task = await create({ description: 'old' });
  expect((await patch(task, { description: ' New ' })).description).toBe('New');
  expect((await patch(task, { description: '  ' })).description).toBe('New');
});

it('a task from another ticket is not found through this one', async () => {
  const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
  const other = await create({ description: 'elsewhere' }, w.admin.agent, t2);
  const res = await tech.agent.patch(`${tasksUrl()}/${other.id}`).send({ completed: true });
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: true, message: 'Task not found', code: 'NOT_FOUND' });
});

it('own-tier users can\'t touch tasks on others\' tickets', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  const task = await create({ description: 'x' });
  for (const res of [
    await own.agent.get(tasksUrl()),
    await own.agent.post(tasksUrl()).send({ description: 'y' }),
    await own.agent.patch(`${tasksUrl()}/${task.id}`).send({ completed: true }),
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

// Likely correct: task changes appear on the ticket timeline and in the audit log. Expected to change in sub-project 3.
it('[quirk] Q8: creating and completing a task writes no activity and no audit row', async () => {
  const task = await create({ description: 'Image laptop' });
  await patch(task, { completed: true });
  const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
  expect(activity.map((a) => a.action)).toEqual(['created']);
  // No endpoint reads AuditLogs.
  expect(await models.AuditLog.count({ where: { entityType: 'TicketTask' } })).toBe(0);
});
