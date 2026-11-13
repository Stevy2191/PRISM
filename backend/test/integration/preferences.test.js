const Sequelize = require('sequelize');
const request = require('supertest');
const {
  resetData, closeDb, getApp, sequelize, models,
} = require('./helpers');
const { API, expectOk, makeWorld, makeTech } = require('./fixtures');
const migration = require('../../migrations/20260101000087-user-preferences');

// A user's own screen choices follow their account (migration 087).

let w;
const URL = `${API}/preferences/tickets.columns`;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);

it('each user keeps their own; unset reads as null; delete goes back to the default', async () => {
  const tech = await makeTech('tech-pref', w.deptA.id);
  expect(expectOk(await tech.agent.get(URL)).value).toBeNull();
  const mine = { order: ['requester', 'status'], visible: { requester: true, status: true, sla: false } };
  expect(expectOk(await tech.agent.put(URL).send({ value: mine })).value).toEqual(mine);
  expectOk(await w.admin.agent.put(URL).send({ value: { order: ['sla'], visible: { sla: true } } }));
  // Saved again: replaced, still one row each.
  expectOk(await tech.agent.put(URL).send({ value: { ...mine, order: ['status', 'requester'] } }));
  expect(expectOk(await tech.agent.get(URL)).value.order).toEqual(['status', 'requester']);
  expect(expectOk(await w.admin.agent.get(URL)).value.order).toEqual(['sla']);
  expect(await models.UserPreference.count()).toBe(2);
  expectOk(await tech.agent.delete(URL));
  expect(expectOk(await tech.agent.get(URL)).value).toBeNull();
  expect(expectOk(await w.admin.agent.get(URL)).value.order).toEqual(['sla']);
});

it('refuses unknown keys, values that are not an object, oversized values and nobody signed in', async () => {
  expect((await w.admin.agent.get(`${API}/preferences/anything.else`)).status).toBe(404);
  expect((await w.admin.agent.put(`${API}/preferences/anything.else`).send({ value: {} })).status).toBe(404);
  expect((await w.admin.agent.put(URL).send({ value: 'all' })).status).toBe(400);
  expect((await w.admin.agent.put(URL).send({ value: [1] })).status).toBe(400);
  expect((await w.admin.agent.put(URL).send({})).status).toBe(400);
  expect((await w.admin.agent.put(URL).send({ value: { blob: 'x'.repeat(17 * 1024) } })).status).toBe(400);
  expect((await request(getApp()).get(URL)).status).toBe(401);
});

it('migration 087 down and up', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  try {
    await expect(qi.describeTable('UserPreferences')).rejects.toThrow();
  } finally {
    await migration.up(qi, Sequelize);
  }
  await migration.up(qi, Sequelize); // idempotent
  expect(Object.keys(await qi.describeTable('UserPreferences'))).toEqual(expect.arrayContaining(['userId', 'key', 'value']));
});
