jest.mock('../../src/services/calendarPush');

const { resetData, closeDb } = require('./helpers');
const { API, expectOk, makeWorld } = require('./fixtures');

// Ticket categories (5c): custom fields limited to category branches.

const CAT = `${API}/ticket-categories`;
let w;
let hw;
let laptop;
let sw;
let serial;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const add = async (name, parentId = null) => expectOk(await w.admin.agent.post(CAT).send({ name, parentId }), 201).category;
  hw = await add('Hardware');
  laptop = await add('Laptop', hw.id);
  sw = await add('Software');
  serial = expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Serial', fieldType: 'text', categoryIds: [hw.id] }), 201).customField;
  expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Notes', fieldType: 'text' }), 201);
});
afterAll(closeDb);

const keys = async (q) => expectOk(await w.admin.agent.get(`${API}/custom-fields?${q}`)).customFields.map((f) => f.fieldKey).sort();
const create = (fields) => w.admin.agent.post(`${API}/tickets`).send({ title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, ...fields });
const values = (id, v) => w.admin.agent.patch(`${API}/tickets/${id}/custom-field-values`).send({ values: v });

it('the field keeps its categoryIds; an unknown or malformed id is refused', async () => {
  expect(serial.categoryIds).toEqual([hw.id]);
  for (const categoryIds of [[99999], [`${hw.id}x`], ['abc'], 'nope']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.admin.agent.post(`${API}/custom-fields`).send({ label: `Bad ${JSON.stringify(categoryIds)}`, fieldType: 'text', categoryIds });
    expect(res.status).toBe(400);
  }
  // Empty = every category.
  const all = expectOk(await w.admin.agent.patch(`${API}/custom-fields/${serial.id}`).send({ categoryIds: [] })).customField;
  expect(all.categoryIds).toBeNull();
});

it('listed for Hardware and Hardware › Laptop, not for Software', async () => {
  expect(await keys(`ticketType=request&categoryId=${hw.id}`)).toEqual(['notes', 'serial']);
  expect(await keys(`ticketType=request&categoryId=${laptop.id}`)).toEqual(['notes', 'serial']);
  expect(await keys(`ticketType=request&categoryId=${sw.id}`)).toEqual(['notes']);
});

it('unscoped fields show for every category and for none; a branch-scoped one not without a category', async () => {
  expect(await keys('ticketType=request')).toEqual(['notes']);
  expect(await keys(`ticketType=request&categoryId=${hw.id}x`)).toEqual(['notes']);
  // The admin listing (no form params) still shows every field.
  expect(await keys('')).toEqual(['notes', 'serial']);
});

it('ticketTypes and categoryIds combine: both must match', async () => {
  expectOk(await w.admin.agent.patch(`${API}/custom-fields/${serial.id}`).send({ ticketTypes: ['incident'] }));
  expect(await keys(`ticketType=request&categoryId=${hw.id}`)).toEqual(['notes']);
  expect(await keys(`ticketType=incident&categoryId=${laptop.id}`)).toEqual(['notes', 'serial']);
});

it('a value is accepted on create in branch and refused out of branch', async () => {
  const t = expectOk(await create({ categoryId: laptop.id, customFieldValues: { serial: 'SN1' } }), 201).ticket;
  expect(t.customFields).toMatchObject({ serial: 'SN1' });
  const res = await create({ categoryId: sw.id, customFieldValues: { serial: 'SN2' } });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('"Serial" doesn\'t apply to this ticket\'s category');
  expect((await create({ customFieldValues: { serial: 'SN3' } })).status).toBe(400);
  // An unscoped field is fine anywhere.
  expectOk(await create({ categoryId: sw.id, customFieldValues: { notes: 'ok' } }), 201);
});

it('after moving to another branch: PATCH title works, the old value stays, a new value is refused, clearing works', async () => {
  const t = expectOk(await create({ categoryId: laptop.id, customFieldValues: { serial: 'SN1' } }), 201).ticket;
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ categoryId: sw.id }));
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ title: 'Renamed' }));
  expect(expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}/custom-field-values`)).customFields).toMatchObject({ serial: 'SN1' });
  expect((await values(t.id, { serial: 'SN9' })).status).toBe(400);
  expectOk(await values(t.id, { serial: '' }));
  expect(expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}/custom-field-values`)).customFields.serial).toBeUndefined();
});

it('changing category and setting a value in the same PATCH checks the new category', async () => {
  const t = expectOk(await create({ categoryId: sw.id }), 201).ticket;
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ categoryId: laptop.id, customFieldValues: { serial: 'SN5' } }));
  const t2 = expectOk(await create({ categoryId: laptop.id }), 201).ticket;
  expect((await w.admin.agent.patch(`${API}/tickets/${t2.id}`).send({ categoryId: sw.id, customFieldValues: { serial: 'SN6' } })).status).toBe(400);
});
