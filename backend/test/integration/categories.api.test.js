const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket,
} = require('./fixtures');

// Ticket categories (5c): the tree API.

const URL = `${API}/ticket-categories`;
let w;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

const add = async (name, parentId = null, extra = {}) => expectOk(await w.admin.agent.post(URL).send({ name, parentId, ...extra }), 201).category;
const list = async (agent = w.admin.agent, q = '') => expectOk(await agent.get(`${URL}${q}`));
const node = async (id) => (await list()).categories.find((c) => c.id === id);
const chain = async (n) => {
  let parent = null;
  const ids = [];
  for (let i = 1; i <= n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    parent = (await add(`L${i}`, parent)).id;
    ids.push(parent);
  }
  return ids;
};

it('any staff can GET; a technician without the permission gets 403 on every write', async () => {
  const hw = await add('Hardware');
  const res = await list(tech.agent);
  expect(res.categories.map((c) => c.name)).toEqual(['Hardware']);
  expect(res.categoryRequired).toBe(false);
  const writes = [
    tech.agent.post(URL).send({ name: 'X' }),
    tech.agent.patch(`${URL}/${hw.id}`).send({ name: 'Y' }),
    tech.agent.post(`${URL}/reorder`).send({ parentId: null, orderedIds: [hw.id] }),
    tech.agent.delete(`${URL}/${hw.id}`),
    tech.agent.put(`${URL}/settings`).send({ categoryRequired: true }),
  ];
  for (const r of await Promise.all(writes)) expect(r.status).toBe(403);
});

it('creates a root and a child; new nodes go last among siblings', async () => {
  const hw = await add('Hardware');
  const laptop = await add('Laptop', hw.id);
  const desk = await add('Desktop', hw.id);
  expect(laptop.parentId).toBe(hw.id);
  expect(desk.sortOrder).toBeGreaterThan(laptop.sortOrder);
  expect((await node(laptop.id)).effectiveActive).toBe(true);
});

it('name is trimmed; empty and over 100 characters are refused', async () => {
  expect((await add('  Network  ')).name).toBe('Network');
  expect((await w.admin.agent.post(URL).send({ name: '   ' })).status).toBe(400);
  expect((await w.admin.agent.post(URL).send({ name: 'x'.repeat(101) })).status).toBe(400);
  expect((await w.admin.agent.post(URL).send({})).status).toBe(400);
});

it('duplicate sibling name (case and space insensitive) is 409', async () => {
  const hw = await add('Hardware');
  await add('Laptop', hw.id);
  const res = await w.admin.agent.post(URL).send({ name: ' laptop ', parentId: hw.id });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('DUPLICATE_NAME');
  // The same name under another parent is fine.
  const sw = await add('Software');
  await add('Laptop', sw.id);
});

it('two roots named "Hardware" / " hardware " → second is 409 DUPLICATE_NAME', async () => {
  await add('Hardware');
  const res = await w.admin.agent.post(URL).send({ name: ' hardware ' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('DUPLICATE_NAME');
});

it('rename to a sibling\'s name is 409; rename to its own name in another case is fine', async () => {
  const a = await add('Alpha');
  await add('Beta');
  expect((await w.admin.agent.patch(`${URL}/${a.id}`).send({ name: 'beta' })).status).toBe(409);
  expectOk(await w.admin.agent.patch(`${URL}/${a.id}`).send({ name: 'ALPHA' }));
});

it('a 6th level is refused', async () => {
  const ids = await chain(5);
  const res = await w.admin.agent.post(URL).send({ name: 'L6', parentId: ids[4] });
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/5 levels/);
});

it('move refused when node depth + subtree height > 5', async () => {
  const deep = await chain(3); // L1 › L2 › L3
  const top = await add('Top');
  const mid = await add('Mid', top.id);
  const low = await add('Low', mid.id); // a 3-level subtree under Top
  // Moving Top (height 3) under L3 (depth 3) would reach depth 6.
  const res = await w.admin.agent.patch(`${URL}/${top.id}`).send({ parentId: deep[2] });
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/5 levels/);
  expect((await node(top.id)).parentId).toBeNull();
  // Under L2 (depth 2) it reaches exactly 5: allowed.
  expectOk(await w.admin.agent.patch(`${URL}/${top.id}`).send({ parentId: deep[1] }));
  expect((await node(low.id)).parentId).toBe(mid.id);
});

it('moving under itself or its own descendant is refused', async () => {
  const [a, , c] = await chain(3);
  expect((await w.admin.agent.patch(`${URL}/${a}`).send({ parentId: c })).status).toBe(400);
  expect((await w.admin.agent.patch(`${URL}/${a}`).send({ parentId: a })).status).toBe(400);
});

it('a move puts the node last under its new parent and back to root with null', async () => {
  const hw = await add('Hardware');
  await add('Laptop', hw.id);
  const sw = await add('Software');
  const moved = expectOk(await w.admin.agent.patch(`${URL}/${sw.id}`).send({ parentId: hw.id })).category;
  expect(moved.parentId).toBe(hw.id);
  expect((await list()).categories.filter((c) => c.parentId === hw.id).map((c) => c.name)).toEqual(['Laptop', 'Software']);
  expect(expectOk(await w.admin.agent.patch(`${URL}/${sw.id}`).send({ parentId: null })).category.parentId).toBeNull();
});

it('parentId "12abc" or unknown is refused and nothing is written', async () => {
  const hw = await add('Hardware');
  for (const parentId of [`${hw.id}abc`, '0', 99999, -1, 1.5]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.admin.agent.post(URL).send({ name: `X${parentId}`, parentId });
    expect(res.status).toBe(400);
  }
  expect(await models.TicketCategory.count()).toBe(1);
  expect((await w.admin.agent.patch(`${URL}/${hw.id}abc`).send({ name: 'Y' })).status).toBe(404);
});

it('reorder sets sortOrder; ids not matching the children are refused', async () => {
  const hw = await add('Hardware');
  const a = await add('A', hw.id);
  const b = await add('B', hw.id);
  const c = await add('C', hw.id);
  expectOk(await w.admin.agent.post(`${URL}/reorder`).send({ parentId: hw.id, orderedIds: [c.id, a.id, b.id] }));
  const kids = (await list()).categories.filter((x) => x.parentId === hw.id).sort((x, y) => x.sortOrder - y.sortOrder);
  expect(kids.map((k) => k.name)).toEqual(['C', 'A', 'B']);
  expect((await w.admin.agent.post(`${URL}/reorder`).send({ parentId: hw.id, orderedIds: [a.id, b.id] })).status).toBe(400);
  expect((await w.admin.agent.post(`${URL}/reorder`).send({ parentId: hw.id, orderedIds: [a.id, b.id, c.id, hw.id] })).status).toBe(400);
  expect((await w.admin.agent.post(`${URL}/reorder`).send({ parentId: hw.id, orderedIds: [a.id, a.id, b.id] })).status).toBe(400);
});

it('retire hides the subtree (effectiveActive false below it); restore brings it back', async () => {
  const [a, b, c] = await chain(3);
  expectOk(await w.admin.agent.patch(`${URL}/${b}`).send({ active: false }));
  expect((await node(a)).effectiveActive).toBe(true);
  expect((await node(b)).effectiveActive).toBe(false);
  expect((await node(c)).effectiveActive).toBe(false);
  expect((await node(c)).active).toBe(true);
  expectOk(await w.admin.agent.patch(`${URL}/${b}`).send({ active: true }));
  expect((await node(c)).effectiveActive).toBe(true);
});

it('requireChild toggles', async () => {
  const hw = await add('Hardware', null, { requireChild: true });
  expect(hw.requireChild).toBe(true);
  expect(expectOk(await w.admin.agent.patch(`${URL}/${hw.id}`).send({ requireChild: false })).category.requireChild).toBe(false);
  expect((await w.admin.agent.patch(`${URL}/${hw.id}`).send({ requireChild: 'yes' })).status).toBe(400);
});

describe('delete', () => {
  let hw;
  let laptop;
  beforeEach(async () => {
    hw = await add('Hardware');
    laptop = await add('Laptop', hw.id);
  });
  const del = (id) => w.admin.agent.delete(`${URL}/${id}`);

  it('an unused leaf deletes (204), then its parent', async () => {
    expect((await del(laptop.id)).status).toBe(204);
    expect((await del(hw.id)).status).toBe(204);
    expect(await models.TicketCategory.count()).toBe(0);
  });

  it('is blocked by a ticket on a descendant', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
    await models.Ticket.update({ categoryId: laptop.id }, { where: { id: t.id } });
    const res = await del(hw.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CATEGORY_IN_USE');
    expect(res.body.usage).toMatchObject({ tickets: 1 });
    expect(await models.TicketCategory.count()).toBe(2);
  });

  it('is blocked by a custom field scoped to a descendant', async () => {
    await models.CustomField.create({ label: 'Serial', fieldKey: 'serial', fieldType: 'text', categoryIds: [laptop.id] });
    const res = await del(hw.id);
    expect(res.status).toBe(409);
    expect(res.body.usage).toMatchObject({ fields: 1 });
  });

  it('is blocked by a workflow condition', async () => {
    const rule = await models.WorkflowRule.create({ name: 'R', triggerEvent: 'ticket_created' });
    await models.WorkflowCondition.create({ ruleId: rule.id, field: 'category', operator: 'is_under', value: String(laptop.id) });
    const res = await del(laptop.id);
    expect(res.status).toBe(409);
    expect(res.body.usage).toMatchObject({ rules: 1 });
  });

  it('is blocked by a recurring rule', async () => {
    await models.RecurringTicket.create({
      title: 'Weekly', frequency: 'weekly', timeOfDay: '09:00', timezone: 'UTC', startDate: '2026-01-01',
      createdById: w.admin.user.id, categoryId: laptop.id,
    });
    const res = await del(hw.id);
    expect(res.status).toBe(409);
    expect(res.body.usage).toMatchObject({ recurring: 1 });
  });
});

it('?usage=1 shows per-node counts to a manager and is left out for a technician', async () => {
  const hw = await add('Hardware');
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  await models.Ticket.update({ categoryId: hw.id }, { where: { id: t.id } });
  const mine = (await list(w.admin.agent, '?usage=1')).categories.find((c) => c.id === hw.id);
  expect(mine.usage).toEqual({ tickets: 1, fields: 0, rules: 0, recurring: 0 });
  const theirs = (await list(tech.agent, '?usage=1')).categories.find((c) => c.id === hw.id);
  expect(theirs.usage).toBeUndefined();
});

it('PUT /settings toggles categoryRequired; a non-boolean is refused', async () => {
  expect(expectOk(await w.admin.agent.put(`${URL}/settings`).send({ categoryRequired: true })).categoryRequired).toBe(true);
  expect((await list(tech.agent)).categoryRequired).toBe(true);
  expect((await w.admin.agent.put(`${URL}/settings`).send({ categoryRequired: 'true' })).status).toBe(400);
});

it('every write leaves its audit row', async () => {
  const hw = await add('Hardware');
  const a = await add('A', hw.id);
  await w.admin.agent.patch(`${URL}/${a.id}`).send({ name: 'A2' });
  await w.admin.agent.patch(`${URL}/${a.id}`).send({ parentId: null });
  await w.admin.agent.post(`${URL}/reorder`).send({ parentId: null, orderedIds: [a.id, hw.id] });
  await w.admin.agent.patch(`${URL}/${a.id}`).send({ active: false });
  await w.admin.agent.patch(`${URL}/${a.id}`).send({ active: true });
  await w.admin.agent.delete(`${URL}/${a.id}`);
  await w.admin.agent.put(`${URL}/settings`).send({ categoryRequired: false });
  const actions = (await models.AuditLog.findAll({ where: { entityType: 'TicketCategory' } })).map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining([
    'ticketCategory.create', 'ticketCategory.update', 'ticketCategory.move', 'ticketCategory.reorder',
    'ticketCategory.retire', 'ticketCategory.restore', 'ticketCategory.delete', 'ticketCategory.settings',
  ]));
});
