const Sequelize = require('sequelize');
const {
  resetData, closeDb, sequelize, models, createUserAndLogin, ROLE,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const migration = require('../../migrations/20260101000073-microsoft365');

// Sub-project 7b, task 1: tenant link, contact identity, detected departments
// and the Microsoft app registration settings.

const API = '/api/v1';
const qi = () => sequelize.getQueryInterface();
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const TENANT = '11111111-2222-3333-4444-555555555555';
const OBJECT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let w;
beforeEach(async () => {
  await resetData();
  await sequelize.query("DELETE FROM SystemSettings WHERE `key` LIKE 'portal.ms%'");
  w = await makeWorld();
});
afterAll(async () => {
  await sequelize.query("DELETE FROM SystemSettings WHERE `key` LIKE 'portal.ms%'");
  await closeDb();
});

it('a tenant links to one company only; companies start unlinked with no sync groups', async () => {
  const a = await makeCompany(w.admin, { name: 'Tenant A' });
  const b = await makeCompany(w.admin, { name: 'Tenant B' });
  const fresh = await models.Company.findByPk(a.id);
  expect([fresh.msTenantId, fresh.msConsentAt, fresh.msSyncGroups, fresh.msLastSync]).toEqual([null, null, [], null]);
  await models.Company.update({ msTenantId: TENANT, msSyncGroups: [{ id: 'g1', name: 'Staff' }] }, { where: { id: a.id } });
  expect((await models.Company.findByPk(a.id)).msSyncGroups).toEqual([{ id: 'g1', name: 'Staff' }]);
  await expect(models.Company.update({ msTenantId: TENANT }, { where: { id: b.id } })).rejects.toThrow();
  // Any number of companies stay unlinked.
  await models.Company.update({ msTenantId: null }, { where: { id: a.id } });
});

it('a Microsoft object id is unique within a company and makes the sign-in method "microsoft"', async () => {
  const other = await models.Contact.create({
    firstName: 'Other', displayName: 'Other', email: 'other@example.test', companyId: w.contact.companyId,
  });
  await models.Contact.update({ msObjectId: OBJECT_ID, msDepartmentName: 'Billing Dept' }, { where: { id: w.contact.id } });
  await expect(models.Contact.update({ msObjectId: OBJECT_ID }, { where: { id: other.id } })).rejects.toThrow();
  const res = await w.admin.agent.get(`${API}/contacts/${w.contact.id}`);
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).toContain('"signInMethod":"microsoft"');
});

it('detected department names are unique per company and drop with the company', async () => {
  const company = await makeCompany(w.admin, { name: 'Detecting' });
  const row = await models.DetectedDepartment.create({ companyId: company.id, name: 'Billing Dept', normalized: 'billing dept', peopleCount: 3 });
  expect((await row.reload()).mappedDepartmentId).toBeNull();
  await expect(models.DetectedDepartment.create({ companyId: company.id, name: 'billing  dept', normalized: 'billing dept' })).rejects.toThrow();
  await models.DetectedDepartment.create({ companyId: w.contact.companyId, name: 'Billing Dept', normalized: 'billing dept' });
  await models.Company.destroy({ where: { id: company.id } });
  expect(await models.DetectedDepartment.count({ where: { companyId: company.id } })).toBe(0);
});

it('the app secret is stored encrypted, never read back, and only an owner may change the app', async () => {
  let res = await w.admin.agent.patch(`${API}/settings`).send({ 'portal.msClientId': 'client-123', 'portal.msClientSecret': 'shh-secret' });
  expect(res.status).toBe(200);
  const [stored] = await select("SELECT value FROM SystemSettings WHERE `key` = 'portal.msClientSecret'");
  expect(stored.value).not.toContain('shh-secret');
  const { getPortalMicrosoftApp } = require('../../src/controllers/settingsController'); // eslint-disable-line global-require
  expect(await getPortalMicrosoftApp()).toEqual({ clientId: 'client-123', clientSecret: 'shh-secret' });

  res = await w.admin.agent.get(`${API}/settings`);
  expect(JSON.stringify(res.body)).not.toContain('shh-secret');
  expect(res.body.settings['portal.msClientSecretSet']).toBe(true);
  expect(res.body.settings['portal.msClientSecret']).toBe('');
  expect(res.body.settings['portal.msClientId']).toBe('client-123');

  // A blank secret leaves the stored one alone.
  await w.admin.agent.patch(`${API}/settings`).send({ 'portal.msClientId': 'client-123', 'portal.msClientSecret': '' });
  expect((await getPortalMicrosoftApp()).clientSecret).toBe('shh-secret');

  const config = await w.admin.agent.get(`${API}/portal/config`);
  expect(config.body.microsoft).toBe(true);

  const admin2 = await createUserAndLogin({ username: 'notowner', roleName: ROLE.ADMIN, legacyRole: 'admin' });
  res = await admin2.agent.patch(`${API}/settings`).send({ 'portal.msClientId': 'hijack' });
  expect(res.status).toBe(403);
  expect((await getPortalMicrosoftApp()).clientId).toBe('client-123');
});

it('portal config says no Microsoft sign-in until both the client id and secret are saved', async () => {
  await w.admin.agent.patch(`${API}/settings`).send({ 'portal.msClientId': 'client-123' });
  const config = await w.admin.agent.get(`${API}/portal/config`);
  expect(config.body.microsoft).toBe(false);
});

it('round trip: down removes the columns and table, up puts them back', async () => {
  const company = await makeCompany(w.admin, { name: 'Round trip' });
  await models.DetectedDepartment.create({ companyId: company.id, name: 'X', normalized: 'x' });
  await migration.down(qi(), Sequelize);
  try {
    expect((await qi().describeTable('Companies')).msTenantId).toBeUndefined();
    expect((await qi().describeTable('Contacts')).msObjectId).toBeUndefined();
    expect((await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName))).not.toContain('DetectedDepartments');
  } finally {
    await migration.up(qi(), Sequelize);
  }
  await migration.up(qi(), Sequelize); // idempotent
  const contacts = await qi().describeTable('Contacts');
  expect(contacts.msObjectId).toBeDefined();
  expect(contacts.msDepartmentName).toBeDefined();
  expect((await qi().describeTable('Companies')).msSyncGroups).toBeDefined();
});
