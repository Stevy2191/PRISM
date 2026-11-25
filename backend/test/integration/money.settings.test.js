const express = require('express');
const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize, createUserAndLogin, ROLE,
} = require('./helpers');
const { API, expectOk, makeWorld, makeTech, makeManager } = require('./fixtures');
const { requireCustomerBilling } = require('../../src/middleware/customerBilling');
const { moneyConfig } = require('../../src/services/money/config');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const migration = require('../../migrations/20260101000104-money-permissions');

// Phase 3, step 1, task 3: the new permissions, the Customer billing switch
// (Owners only) and the money settings.

let w;
const a = () => w.admin.agent;
const KEYS = [
  'money.billing.view', 'money.billing.manage', 'money.settings', 'money.rates.manage', 'money.timesheets.approve',
  'money.bills.manage', 'money.purchasing.manage', 'money.sales.manage', 'money.books.view',
];

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
});
afterAll(closeDb);

it('creates the permissions; admins get them all, department managers only timesheet approval', async () => {
  const perms = await models.Permission.findAll({ where: { key: KEYS } });
  expect(perms.map((p) => p.key).sort()).toEqual([...KEYS].sort());
  expect(perms.every((p) => p.category === 'money')).toBe(true);
  const granted = async (roleName) => (await sequelize.query(
    `SELECT p.\`key\` FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId JOIN Roles r ON r.id = rp.roleId
      WHERE r.name = :roleName AND p.category = 'money' AND rp.granted = 1`,
    { replacements: { roleName }, type: Sequelize.QueryTypes.SELECT },
  )).map((r) => r.key).sort();
  expect(await granted(ROLE.ADMIN)).toEqual([...KEYS].sort());
  expect(await granted(ROLE.DEPARTMENT_MANAGER)).toEqual(['money.timesheets.approve']);
  expect(await granted(ROLE.TECHNICIAN)).toEqual([]);
});

it('has the defaults, and an admin reads them', async () => {
  const cfg = await moneyConfig();
  expect(cfg).toMatchObject({
    customerBilling: false, currency: 'USD', hourlyRate: '0.00', afterHoursRate: '0.00', tripCharge: '0.00',
    eventMinimumMinutes: 60, stepMinutes: 30, defaultMarkupPercent: '0.0000', defaultTermsDays: 30,
  });
  expect(cfg.frontlineSkuIds).toHaveLength(3);
  const shown = expectOk(await a().get(`${API}/money/settings`)).settings;
  expect(shown).toMatchObject({ currency: 'USD', customerBilling: false });
});

it('sets the rates, checking each value', async () => {
  const put = (body) => a().put(`${API}/money/rates`).send(body);
  const saved = expectOk(await put({
    hourlyRate: '100', afterHoursRate: '150.50', tripCharge: '45', eventMinimumMinutes: 60, stepMinutes: 30,
  })).rates;
  expect(saved).toMatchObject({ hourlyRate: '100.00', afterHoursRate: '150.50', tripCharge: '45.00' });
  expect((await moneyConfig()).afterHoursRate).toBe('150.50');
  expect((await put({ hourlyRate: '-1' })).status).toBe(400);
  expect((await put({ hourlyRate: '10.005' })).status).toBe(400);
  expect((await put({ hourlyRate: 'abc' })).status).toBe(400);
  expect((await put({ eventMinimumMinutes: 481 })).status).toBe(400);
  expect((await put({ stepMinutes: 0 })).status).toBe(400);
  expect((await put({ stepMinutes: 7.5 })).status).toBe(400);
  expect(await models.AuditLog.count({ where: { action: 'money.rates' } })).toBe(1);
});

it('a technician sees only the switch and the currency', async () => {
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/settings`)).status).toBe(403);
  expect((await tech.agent.put(`${API}/money/rates`).send({ hourlyRate: '1' })).status).toBe(403);
  expect(expectOk(await tech.agent.get(`${API}/money/config`))).toEqual({ customerBilling: false, currency: 'USD' });
});

it('only an Owner turns Customer billing on; other settings need money.settings', async () => {
  const other = await createUserAndLogin({ username: 'adam', roleName: ROLE.ADMIN, legacyRole: 'admin' });
  expect((await other.agent.put(`${API}/money/settings`).send({ customerBilling: true })).status).toBe(403);
  expectOk(await other.agent.put(`${API}/money/settings`).send({ currency: 'usd', defaultTermsDays: 15 }));
  expect((await moneyConfig())).toMatchObject({ currency: 'USD', defaultTermsDays: 15, customerBilling: false });
  expectOk(await a().put(`${API}/money/settings`).send({ customerBilling: true }));
  expect((await moneyConfig()).customerBilling).toBe(true);
  expect((await a().put(`${API}/money/settings`).send({ currency: 'dollars' })).status).toBe(400);
  expect((await a().put(`${API}/money/settings`).send({ defaultMarkupPercent: '-5' })).status).toBe(400);
  const manager = await makeManager('mia', w.deptA.id);
  expect((await manager.agent.put(`${API}/money/settings`).send({ defaultTermsDays: 10 })).status).toBe(403);
});

it('requireCustomerBilling answers 404 while the switch is off', async () => {
  const app = express();
  app.get('/x', requireCustomerBilling, (req, res) => res.json({ ok: true }));
  const request = require('supertest');
  expect((await request(app).get('/x')).status).toBe(404);
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  expect((await request(app).get('/x')).status).toBe(200);
});

it('migration 104 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  expect(await models.Permission.count({ where: { key: KEYS } })).toBe(0);
  await migration.up(qi, Sequelize);
  expect(await models.Permission.count({ where: { key: KEYS } })).toBe(KEYS.length);
});
