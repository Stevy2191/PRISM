jest.mock('../../src/services/calendarPush');

const { resetData, closeDb } = require('./helpers');
const { API, expectOk, makeWorld } = require('./fixtures');

// Ticket categories (5c): the workflow "category" condition and the custom
// report column / grouping.

const CAT = `${API}/ticket-categories`;
let w;
let hw;
let laptop;
let battery;
let sw;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const add = async (name, parentId = null) => expectOk(await w.admin.agent.post(CAT).send({ name, parentId }), 201).category;
  hw = await add('Hardware');
  laptop = await add('Laptop', hw.id);
  battery = await add('Battery', laptop.id);
  sw = await add('Software');
});
afterAll(closeDb);

const ruleBody = (conditions) => ({
  name: 'Rule', triggerEvent: 'ticket_created', conditions, actions: [{ actionType: 'add_tag', actionValue: { tag: 'wf' } }],
});
const makeRule = async (conditions) => expectOk(await w.admin.agent.post(`${API}/workflow-rules`).send(ruleBody(conditions)), 201).rule;
const ticketWith = async (categoryId) => {
  const t = expectOk(await w.admin.agent.post(`${API}/tickets`).send({
    title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, categoryId,
  }), 201).ticket;
  return expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket;
};
const fired = (t) => (t.tags || []).includes('wf');

describe('workflow condition', () => {
  it('is matches the exact node only', async () => {
    await makeRule([{ field: 'category', operator: 'is', value: String(laptop.id) }]);
    expect(fired(await ticketWith(laptop.id))).toBe(true);
    expect(fired(await ticketWith(battery.id))).toBe(false);
    expect(fired(await ticketWith(hw.id))).toBe(false);
  });

  it('is_under matches the node and its descendants, not siblings', async () => {
    await makeRule([{ field: 'category', operator: 'is_under', value: String(hw.id) }]);
    expect(fired(await ticketWith(hw.id))).toBe(true);
    expect(fired(await ticketWith(battery.id))).toBe(true);
    expect(fired(await ticketWith(sw.id))).toBe(false);
    expect(fired(await ticketWith(null))).toBe(false);
  });

  it('is_empty matches uncategorized; is_not_empty the rest', async () => {
    await makeRule([{ field: 'category', operator: 'is_empty' }]);
    expect(fired(await ticketWith(null))).toBe(true);
    expect(fired(await ticketWith(sw.id))).toBe(false);
  });

  it('is / is_under on a non-category field is refused', async () => {
    const res = await w.admin.agent.post(`${API}/workflow-rules`).send(ruleBody([{ field: 'priority', operator: 'is_under', value: 'high' }]));
    expect(res.status).toBe(400);
  });

  it('a category condition needs a known id and one of its own operators', async () => {
    for (const c of [
      { field: 'category', operator: 'is', value: '99999' },
      { field: 'category', operator: 'is_under', value: `${hw.id}x` },
      { field: 'category', operator: 'is', value: '' },
      { field: 'category', operator: 'equals', value: String(hw.id) },
      { field: 'category', operator: 'contains', value: 'Hard' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await w.admin.agent.post(`${API}/workflow-rules`).send(ruleBody([c]));
      expect(res.status).toBe(400);
    }
  });
});

describe('custom report', () => {
  const run = async (body) => expectOk(await w.admin.agent.post(`${API}/reports/custom`).send({ dataSource: 'tickets', ...body }));

  it('the metadata lists the category field and grouping', async () => {
    const meta = expectOk(await w.admin.agent.get(`${API}/reports/custom/metadata`));
    const tickets = meta.dataSources.find((d) => d.key === 'tickets');
    expect(tickets.fields.map((f) => f.key)).toContain('category');
    expect(tickets.groupBy).toContain('category');
  });

  it('the column shows the full path', async () => {
    const t = await ticketWith(laptop.id);
    const { tableData } = await run({ fields: ['title', 'category'] });
    expect(tableData.rows.find((r) => r.id === t.id).category).toBe('Hardware › Laptop');
  });

  it('group by category uses the full path and puts uncategorized under "Uncategorized"', async () => {
    await ticketWith(laptop.id);
    await ticketWith(laptop.id);
    await ticketWith(sw.id);
    await ticketWith(null);
    const { chartData } = await run({ fields: ['title'], groupBy: 'category' });
    expect(Object.fromEntries(chartData.map((g) => [g.name, g.count]))).toEqual({
      'Hardware › Laptop': 2, Software: 1, Uncategorized: 1,
    });
  });
});
