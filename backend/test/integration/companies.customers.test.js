const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeCompany } = require('./fixtures');

// CS: the Companies list is customers and vendors. Your own company's page
// is in Settings; pickers still get every company.

let w;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);

it('leaves your own company out of the list when asked, and keeps it for pickers', async () => {
  await makeCompany(w.admin, { name: 'Acme' });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const list = expectOk(await w.admin.agent.get(`${API}/companies`).query({ own: 'exclude' }));
  expect(list.companies.map((c) => c.name)).toEqual(['Acme']);
  expect(list.companies.some((c) => c.id === internal.id)).toBe(false);
  const all = expectOk(await w.admin.agent.get(`${API}/companies`));
  expect(all.companies.some((c) => c.id === internal.id)).toBe(true);
});

// CS: how a person's timer runs is theirs alone (Preferences). There is no
// default for new accounts to set in Settings.
it('has no timer defaults for new users, and a new account starts on manual', async () => {
  const settings = expectOk(await w.admin.agent.get(`${API}/settings`)).settings;
  expect(settings['timeTracking.defaultMode']).toBeUndefined();
  expect(settings['timeTracking.defaultMinThreshold']).toBeUndefined();
  const refused = await w.admin.agent.put(`${API}/settings`).send({ settings: { 'timeTracking.defaultMode': 'automatic' } });
  expect((await models.SystemSettings.findByPk('timeTracking.defaultMode'))).toBeNull();
  expect([200, 400]).toContain(refused.status);
  const made = expectOk(await w.admin.agent.post(`${API}/users`).send({
    username: 'newperson', displayName: 'New Person', password: 'IntegrationPass!2026', departmentId: w.deptA.id,
  }), 201);
  const user = await models.User.findByPk((made.user || made).id);
  expect(user.timerMode).toBe('manual');
  expect(user.timerMinThreshold).toBe(0);
});
