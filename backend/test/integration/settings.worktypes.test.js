const { Op } = require('sequelize');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket,
} = require('./fixtures');

// Work types are editable (spec: WorkTypes): a type in use is deactivated,
// not deleted, and at least one stays active.

let w;
let seeded;
beforeAll(async () => {
  seeded = (await models.WorkType.findAll({ raw: true })).map(({ createdAt, updatedAt, ...row }) => row);
});
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(async () => {
  // Work types are seeded, not reset: put the seeded rows back as they were.
  await models.TimeEntry.destroy({ where: {} });
  await models.WorkType.destroy({ where: { id: { [Op.notIn]: seeded.map((s) => s.id) } } });
  for (const row of seeded) await models.WorkType.update(row, { where: { id: row.id } }); // eslint-disable-line no-await-in-loop
});
afterAll(closeDb);

const err = (message, code = 'VALIDATION_ERROR') => ({ error: true, message, code });
const make = async (body) => expectOk(await w.admin.agent.post(`${API}/work-types`).send(body), 201).workType;

it('creates and edits a work type', async () => {
  const t = await make({ name: ' Training ', billableDefault: false });
  expect(t).toEqual(expect.objectContaining({ name: 'Training', billableDefault: false, isActive: true }));
  const edited = expectOk(await w.admin.agent.patch(`${API}/work-types/${t.id}`).send({ name: 'Training (internal)', billableDefault: true })).workType;
  expect([edited.name, edited.billableDefault]).toEqual(['Training (internal)', true]);
  expect(expectOk(await w.admin.agent.get(`${API}/work-types`)).workTypes.map((x) => x.name)).toContain('Training (internal)');
});

it('validates input', async () => {
  const bad = async (body, message) => expect((await w.admin.agent.post(`${API}/work-types`).send(body)).body).toEqual(err(message));
  await bad({ name: 'On-site' }, 'A work type with that name already exists');
  await bad({ name: '  ' }, 'Work type name is required');
  await bad({ name: ['x'] }, 'Work type name is required');
  await bad({ name: 'x'.repeat(101) }, 'Work type name must be 100 characters or fewer');
  expect((await w.admin.agent.patch(`${API}/work-types/12abc`).send({ name: 'x' })).status).toBe(404);
});

it('a type in use is deactivated, not deleted; inactive types aren\'t offered for new time', async () => {
  const t = await make({ name: 'Training' });
  const ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 5, workTypeId: t.id }), 201);
  const res = await w.admin.agent.delete(`${API}/work-types/${t.id}`);
  expect([res.status, res.body]).toEqual([409, err('This work type is used by time entries; deactivate it instead', 'WORK_TYPE_IN_USE')]);
  expectOk(await w.admin.agent.patch(`${API}/work-types/${t.id}`).send({ isActive: false }));
  expect((await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 5, workTypeId: t.id })).body.message)
    .toBe('Unknown work type');
});

it('an unused type is deleted; the last active type can\'t be deactivated or deleted', async () => {
  const t = await make({ name: 'Spare' });
  expectOk(await w.admin.agent.delete(`${API}/work-types/${t.id}`));
  const [last, ...rest] = expectOk(await w.admin.agent.get(`${API}/work-types`)).workTypes;
  await models.WorkType.update({ isActive: false }, { where: { id: rest.map((x) => x.id) } });
  expect((await w.admin.agent.patch(`${API}/work-types/${last.id}`).send({ isActive: false })).body)
    .toEqual(err('At least one work type must stay active'));
  expect((await w.admin.agent.delete(`${API}/work-types/${last.id}`)).body).toEqual(err('At least one work type must stay active'));
});

it('editing needs settings.manage_system', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  const [first] = expectOk(await tech.agent.get(`${API}/work-types`)).workTypes;
  expect((await tech.agent.post(`${API}/work-types`).send({ name: 'x' })).status).toBe(403);
  expect((await tech.agent.patch(`${API}/work-types/${first.id}`).send({ name: 'x' })).status).toBe(403);
  expect((await tech.agent.delete(`${API}/work-types/${first.id}`)).status).toBe(403);
});
