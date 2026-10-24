// Outbound email (the auto-reply) is recorded, not sent.
jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeOwnTier,
} = require('./fixtures');
const { handleParsedMessage } = require('../../src/services/inboundEmailService');
const { runDueRecurring } = require('../../src/services/recurring/recurringScheduler');

// Ticket categories (5c) on tickets: create, update, read, list filter.

const CAT = `${API}/ticket-categories`;
let w;
let hw;
let laptop;
let battery;
let sw;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const add = async (name, parentId = null, extra = {}) => expectOk(await w.admin.agent.post(CAT).send({ name, parentId, ...extra }), 201).category;
  hw = await add('Hardware', null, { requireChild: true });
  laptop = await add('Laptop', hw.id);
  battery = await add('Battery', laptop.id);
  sw = await add('Software');
});
afterAll(closeDb);

const base = () => ({ title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
const create = (fields, agent = w.admin.agent) => agent.post(`${API}/tickets`).send({ ...base(), ...fields });
const patch = (id, fields, agent = w.admin.agent) => agent.patch(`${API}/tickets/${id}`).send(fields);
const retire = async (id) => expectOk(await w.admin.agent.patch(`${CAT}/${id}`).send({ active: false }));

describe('create', () => {
  it('with a leaf: the category path is in the response', async () => {
    const t = expectOk(await create({ categoryId: battery.id }), 201).ticket;
    expect(t.category).toEqual({ id: battery.id, path: ['Hardware', 'Laptop', 'Battery'] });
    const got = expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket;
    expect(got.category).toEqual({ id: battery.id, path: ['Hardware', 'Laptop', 'Battery'] });
  });

  it('with a requireChild parent → 400 "Choose a sub-category under Hardware"', async () => {
    const res = await create({ categoryId: hw.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Choose a sub-category under Hardware');
  });

  it('a requireChild parent whose children are all retired is allowed', async () => {
    await retire(laptop.id);
    expectOk(await create({ categoryId: hw.id }), 201);
  });

  it('a retired category, or a child of a retired one, is refused', async () => {
    await retire(sw.id);
    expect((await create({ categoryId: sw.id })).status).toBe(400);
    await retire(laptop.id);
    expect((await create({ categoryId: battery.id })).status).toBe(400);
  });

  it('"12abc", unknown ids and non-integers are refused', async () => {
    for (const categoryId of [`${sw.id}abc`, 99999, 1.5, -1, {}]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await create({ categoryId });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Category not found');
    }
    expect(await models.Ticket.count()).toBe(0);
  });

  it('null is always allowed', async () => {
    const t = expectOk(await create({ categoryId: null }), 201).ticket;
    expect(t.category).toBeNull();
    expect(expectOk(await create({}), 201).ticket.category).toBeNull();
  });

  it('categoryRequired=true: a staff POST without one is refused', async () => {
    expectOk(await w.admin.agent.put(`${CAT}/settings`).send({ categoryRequired: true }));
    const res = await create({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A category is required');
    expectOk(await create({ categoryId: sw.id }), 201);
  });

  it('categoryRequired=true with no active categories: creating still works (nothing to pick)', async () => {
    expectOk(await w.admin.agent.put(`${CAT}/settings`).send({ categoryRequired: true }));
    await retire(hw.id);
    await retire(sw.id);
    expect(expectOk(await create({}), 201).ticket.category).toBeNull();
    // With one active root again, it is required again.
    expectOk(await w.admin.agent.patch(`${CAT}/${sw.id}`).send({ active: true }));
    expect((await create({})).status).toBe(400);
  });

  it('categoryRequired=true: inbound email still creates an uncategorized ticket', async () => {
    expectOk(await w.admin.agent.put(`${CAT}/settings`).send({ categoryRequired: true }));
    let raw = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mail', 'generic.eml'), 'utf8');
    const vars = {
      DMARC: 'pass', FROM: 'newcomer@acme.com', TO: 'help@prism.example', CC: '', SUBJECT: 'Help', ID: 'c1',
    };
    for (const [k, v] of Object.entries(vars)) raw = raw.split(`%${k}%`).join(v);
    const out = await handleParsedMessage(await simpleParser(raw), { address: 'help@prism.example', trustedAuthServId: 'mx.prism.example' });
    expect(out.action).toBe('ticket_created');
    expect((await models.Ticket.findByPk(out.ticketId)).categoryId).toBeNull();
  });
});

describe('update', () => {
  let t;
  beforeEach(async () => { t = expectOk(await create({ categoryId: laptop.id }), 201).ticket; });

  it('PATCH categoryId changes it and logs activity', async () => {
    const res = expectOk(await patch(t.id, { categoryId: sw.id })).ticket;
    expect(res.category).toEqual({ id: sw.id, path: ['Software'] });
    const act = await models.TicketActivity.findOne({ where: { ticketId: t.id, action: 'categoryId' } });
    expect(act).toMatchObject({ fromValue: 'Hardware › Laptop', toValue: 'Software' });
  });

  it('PATCH title on a ticket whose category was retired → 200, category kept', async () => {
    await retire(hw.id);
    const res = expectOk(await patch(t.id, { title: 'Renamed' })).ticket;
    expect(res.category).toEqual({ id: laptop.id, path: ['Hardware', 'Laptop'] });
    // Re-sending the same (retired) category, as a whole-ticket PATCH does, is fine too.
    expectOk(await patch(t.id, { categoryId: laptop.id, title: 'Again' }));
  });

  it('the same for a category that later gained requireChild', async () => {
    expectOk(await w.admin.agent.patch(`${CAT}/${laptop.id}`).send({ requireChild: true }));
    expectOk(await patch(t.id, { title: 'Renamed', categoryId: laptop.id }));
  });

  it('PATCH to a different retired category → 400; to null → cleared', async () => {
    await retire(sw.id);
    expect((await patch(t.id, { categoryId: sw.id })).status).toBe(400);
    expect(expectOk(await patch(t.id, { categoryId: null })).ticket.category).toBeNull();
  });

  it('PATCH to a requireChild parent → 400', async () => {
    expect((await patch(t.id, { categoryId: hw.id })).status).toBe(400);
  });
});

describe('list filter', () => {
  let tLaptop;
  let tBattery;
  let tSoftware;
  let tNone;
  beforeEach(async () => {
    tLaptop = expectOk(await create({ title: 'L', categoryId: laptop.id }), 201).ticket;
    tBattery = expectOk(await create({ title: 'B', categoryId: battery.id }), 201).ticket;
    tSoftware = expectOk(await create({ title: 'S', categoryId: sw.id }), 201).ticket;
    tNone = expectOk(await create({ title: 'N' }), 201).ticket;
  });
  const ids = async (q, agent = w.admin.agent) => expectOk(await agent.get(`${API}/tickets?${q}`)).tickets.map((t) => t.id).sort((a, b) => a - b);

  it('?category=<root> includes descendants', async () => {
    expect(await ids(`category=${hw.id}`)).toEqual([tLaptop.id, tBattery.id].sort((a, b) => a - b));
  });

  it('?category=<leaf> excludes siblings and parents', async () => {
    expect(await ids(`category=${battery.id}`)).toEqual([tBattery.id]);
    expect(await ids(`category=${sw.id}`)).toEqual([tSoftware.id]);
  });

  it('unknown or malformed ids match nothing, never everything', async () => {
    expect(await ids('category=99999')).toEqual([]);
    expect(await ids(`category=${hw.id}abc`)).toEqual([]);
    expect(await ids('category=')).toEqual(expect.arrayContaining([tNone.id]));
  });

  it('is not a way around ticket scope', async () => {
    // An own-tier user sees only tickets assigned to them, category or not.
    const owen = await makeOwnTier(w.admin, 'owen', w.deptA.id);
    expectOk(await patch(tBattery.id, { assigneeId: owen.user.id }));
    expect(await ids(`category=${hw.id}`, owen.agent)).toEqual([tBattery.id]);
  });
});

describe('bulk and recurring', () => {
  const bulk = (body) => w.admin.agent.post(`${API}/tickets/bulk`).send(body);

  it('bulk category sets it on every selected ticket', async () => {
    const a = expectOk(await create({ title: 'A' }), 201).ticket;
    const b = expectOk(await create({ title: 'B', categoryId: sw.id }), 201).ticket;
    const res = expectOk(await bulk({ ids: [a.id, b.id], action: 'category', value: laptop.id }));
    expect(res.results.every((r) => r.ok)).toBe(true);
    expect((await models.Ticket.findAll({ where: { id: [a.id, b.id] } })).map((t) => t.categoryId)).toEqual([laptop.id, laptop.id]);
    // null clears it.
    expectOk(await bulk({ ids: [a.id], action: 'category', value: null }));
    expect((await models.Ticket.findByPk(a.id)).categoryId).toBeNull();
  });

  it('bulk with a requireChild parent: every ticket reported failed, none changed', async () => {
    const a = expectOk(await create({ title: 'A', categoryId: sw.id }), 201).ticket;
    const b = expectOk(await create({ title: 'B' }), 201).ticket;
    const res = expectOk(await bulk({ ids: [a.id, b.id], action: 'category', value: hw.id }));
    expect(res.results.every((r) => !r.ok && r.error === 'Choose a sub-category under Hardware')).toBe(true);
    expect((await models.Ticket.findAll({ where: { id: [a.id, b.id] }, order: [['id', 'ASC']] })).map((t) => t.categoryId)).toEqual([sw.id, null]);
  });

  const daily = {
    frequency: 'daily', interval: 1, timeOfDay: '09:00', timezone: 'America/Chicago', startDate: '2026-01-01',
  };
  const saveRule = (fields) => w.admin.agent.post(`${API}/recurring-tickets`).send({
    title: 'Daily check', contactId: w.contact.id, departmentId: w.deptA.id, ...daily, ...fields,
  });
  const runOnce = async (ruleId) => {
    await models.RecurringTicket.update({ nextRunAt: new Date('2026-03-02T15:00:00Z') }, { where: { id: ruleId } });
    return runDueRecurring(new Date('2026-03-02T15:00:30Z'));
  };

  it('a recurring rule saves categoryId; a retired or requireChild category is refused on save', async () => {
    const r = expectOk(await saveRule({ categoryId: laptop.id }), 201).rule;
    expect(r.category).toEqual({ id: laptop.id, path: ['Hardware', 'Laptop'] });
    expect(r.categoryRetired).toBe(false);
    expect((await saveRule({ categoryId: hw.id })).status).toBe(400);
    await retire(sw.id);
    expect((await saveRule({ categoryId: sw.id })).status).toBe(400);
    expect((await saveRule({ categoryId: `${sw.id}x` })).status).toBe(400);
  });

  it('an active template category: the ticket carries it', async () => {
    const r = expectOk(await saveRule({ categoryId: battery.id }), 201).rule;
    expect(await runOnce(r.id)).toEqual({ created: 1, paused: 0 });
    expect((await models.Ticket.findOne({ where: { source: 'recurring' } })).categoryId).toBe(battery.id);
  });

  it('retired template category → ticket created uncategorized, rule still active, list shows categoryRetired', async () => {
    const r = expectOk(await saveRule({ categoryId: battery.id }), 201).rule;
    await retire(laptop.id);
    expect(await runOnce(r.id)).toEqual({ created: 1, paused: 0 });
    expect((await models.Ticket.findOne({ where: { source: 'recurring' } })).categoryId).toBeNull();
    expect((await models.RecurringTicket.findByPk(r.id)).active).toBe(true);
    const listed = expectOk(await w.admin.agent.get(`${API}/recurring-tickets`)).rules.find((x) => x.id === r.id);
    expect(listed.categoryRetired).toBe(true);
    // Saving the rule again without touching the category keeps it.
    expectOk(await w.admin.agent.patch(`${API}/recurring-tickets/${r.id}`).send({ title: 'Renamed' }));
  });

  it('a template category that later gained requireChild: created uncategorized, not paused', async () => {
    const r = expectOk(await saveRule({ categoryId: laptop.id }), 201).rule;
    expectOk(await w.admin.agent.patch(`${CAT}/${laptop.id}`).send({ requireChild: true }));
    expect(await runOnce(r.id)).toEqual({ created: 1, paused: 0 });
    expect((await models.Ticket.findOne({ where: { source: 'recurring' } })).categoryId).toBeNull();
  });
});
