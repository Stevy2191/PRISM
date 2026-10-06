const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, taskStatusId,
} = require('./fixtures');

// Task statuses are editable per scope (spec: Status lists): a status in use
// can't be deleted, a protected one never, and each scope keeps at least one
// open and one closed status.

let w;
let seeded;
beforeAll(async () => {
  seeded = (await models.TaskStatus.findAll({ raw: true })).map(({ createdAt, updatedAt, ...row }) => row);
});
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(async () => {
  // Task statuses are seeded, not reset: put the seeded rows back as they were.
  await models.Task.destroy({ where: {} });
  await models.TaskStatus.destroy({ where: { id: { [require('sequelize').Op.notIn]: seeded.map((s) => s.id) } } }); // eslint-disable-line global-require
  for (const row of seeded) await models.TaskStatus.update(row, { where: { id: row.id } }); // eslint-disable-line no-await-in-loop
});
afterAll(closeDb);

const err = (message, code = 'VALIDATION_ERROR') => ({ error: true, message, code });
const make = async (body) => expectOk(await w.admin.agent.post(`${API}/task-statuses`).send(body), 201).status;
const list = async (scope = 'ticket') => expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=${scope}`)).statuses;

it('creates, renames and reorders statuses in a scope', async () => {
  const s = await make({ scope: 'ticket', name: ' Waiting ', color: '#aa00aa', behaviorType: 'open' });
  expect(s).toEqual(expect.objectContaining({ scope: 'ticket', name: 'Waiting', color: '#aa00aa', behaviorType: 'open', position: 3 }));
  expect(expectOk(await w.admin.agent.patch(`${API}/task-statuses/${s.id}`).send({ name: 'Waiting on customer' })).status.name)
    .toBe('Waiting on customer');
  const ids = (await list()).map((x) => x.id);
  const order = [s.id, ...ids.filter((id) => id !== s.id)];
  expect(expectOk(await w.admin.agent.put(`${API}/task-statuses/reorder`).send({ scope: 'ticket', order })).statuses.map((x) => x.id))
    .toEqual(order);
  expect((await list()).map((x) => x.id)).toEqual(order);
  // The project list is its own.
  expect((await list('project')).map((x) => x.id)).not.toContain(s.id);
});

it('validates input', async () => {
  const bad = async (body, message) => expect((await w.admin.agent.post(`${API}/task-statuses`).send(body)).body).toEqual(err(message));
  await bad({ name: 'x' }, 'scope must be ticket or project');
  await bad({ scope: 'ticket', name: ' ' }, 'Status name is required');
  await bad({ scope: 'ticket', name: { x: 1 } }, 'Status name is required');
  await bad({ scope: 'ticket', name: 'x', behaviorType: 'weird' }, 'Invalid behaviorType');
  await bad({ scope: 'ticket', name: 'x', color: 'red;}' }, 'Color must be a hex color like #3b82f6');
  await bad({ scope: 'ticket', name: 'To do' }, 'A ticket task status with that name already exists');
  const reorder = await w.admin.agent.put(`${API}/task-statuses/reorder`).send({ scope: 'ticket', order: [1] });
  expect(reorder.body).toEqual(err('order must list every status in the scope exactly once'));
  expect((await w.admin.agent.patch(`${API}/task-statuses/12abc`).send({ name: 'x' })).status).toBe(404);
});

it('a status in use can\'t be deleted; a protected one never; an unused one can', async () => {
  const s = await make({ scope: 'ticket', name: 'Parked' });
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'x', statusId: s.id }), 201);
  expect((await w.admin.agent.delete(`${API}/task-statuses/${s.id}`)).body)
    .toEqual(err('This status is used by 1 task; move them to another status first', 'STATUS_IN_USE'));
  const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
  expect((await w.admin.agent.delete(`${API}/task-statuses/${done}`)).body)
    .toEqual(err('This status is protected and cannot be deleted', 'PROTECTED_STATUS'));
  const spare = await make({ scope: 'ticket', name: 'Spare' });
  expectOk(await w.admin.agent.delete(`${API}/task-statuses/${spare.id}`));
  expect((await list()).map((x) => x.name)).not.toContain('Spare');
});

it('a scope keeps at least one open and one closed status', async () => {
  const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
  expect((await w.admin.agent.patch(`${API}/task-statuses/${done}`).send({ behaviorType: 'open' })).body)
    .toEqual(err('Each list needs at least one open and one closed status'));
  expect((await list()).find((x) => x.id === done).behaviorType).toBe('closed'); // the refused change was rolled back
  const inProgress = await taskStatusId(w.admin.agent, 'ticket', 'In progress');
  expectOk(await w.admin.agent.patch(`${API}/task-statuses/${inProgress}`).send({ behaviorType: 'closed' }));
  const todo = await taskStatusId(w.admin.agent, 'ticket', 'To do');
  expect((await w.admin.agent.patch(`${API}/task-statuses/${todo}`).send({ behaviorType: 'closed' })).body)
    .toEqual(err('Each list needs at least one open and one closed status'));
});

it('the default status is what a new task gets', async () => {
  const inProgress = await taskStatusId(w.admin.agent, 'ticket', 'In progress');
  expectOk(await w.admin.agent.patch(`${API}/task-statuses/${inProgress}`).send({ isDefault: true }));
  expect((await list()).filter((x) => x.isDefault).map((x) => x.id)).toEqual([inProgress]);
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  const { task } = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'x' }), 201);
  expect(task.statusId).toBe(inProgress);
  // A closed status can't be the default.
  const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
  expect((await w.admin.agent.patch(`${API}/task-statuses/${done}`).send({ isDefault: true })).body)
    .toEqual(err('The default status must be an open one'));
});

it('editing needs settings.manage_statuses; reading needs a login only', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
  expect((await tech.agent.post(`${API}/task-statuses`).send({ scope: 'ticket', name: 'x' })).status).toBe(403);
  expect((await tech.agent.patch(`${API}/task-statuses/${done}`).send({ name: 'x' })).status).toBe(403);
  expect((await tech.agent.delete(`${API}/task-statuses/${done}`)).status).toBe(403);
  expect((await tech.agent.put(`${API}/task-statuses/reorder`).send({ scope: 'ticket', order: [] })).status).toBe(403);
  expectOk(await tech.agent.get(`${API}/task-statuses`));
});
