const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld } = require('./fixtures');
const { getTemplate } = require('../../src/services/email/templates');
const { DEFAULT_EMAIL_PREFS } = require('../../src/services/email/emailDefaults');

// CS: a staff notification email is decided in two places only: the help
// desk's default (Settings › Notifications) and each person's own choice
// (Preferences). Its template has wording, not a switch of its own.

let w;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);
afterEach(async () => {
  await models.EmailTemplate.destroy({ where: { key: ['staff_assigned', 'contact_resolved'] } });
  await models.SystemSettings.destroy({ where: { key: 'notifications.emailDefaults' } });
});

it("a staff template can't be switched off; a contact template still can", async () => {
  const body = { subject: 'S', bodyHtml: '<p>B</p>', enabled: false };
  expectOk(await w.admin.agent.put(`${API}/settings/email-templates/staff_assigned`).send(body));
  expectOk(await w.admin.agent.put(`${API}/settings/email-templates/contact_resolved`).send(body));
  expect((await getTemplate('staff_assigned')).enabled).toBe(true);
  expect((await getTemplate('contact_resolved')).enabled).toBe(false);
  const { templates } = expectOk(await w.admin.agent.get(`${API}/settings/email-templates`));
  const byKey = Object.fromEntries(templates.map((t) => [t.key, t.enabled]));
  expect(byKey.staff_assigned).toBe(true);
  expect(byKey.contact_resolved).toBe(false);
});

it('a staff template switched off before still sends', async () => {
  await models.EmailTemplate.create({ key: 'staff_assigned', subject: 'S', bodyHtml: '<p>B</p>', enabled: false });
  expect((await getTemplate('staff_assigned')).enabled).toBe(true);
});

it('every emailing event has a default, whatever was stored', async () => {
  await models.SystemSettings.upsert({ key: 'notifications.emailDefaults', value: JSON.stringify({ assigned: false, comment: true }) });
  const { settings } = expectOk(await w.admin.agent.get(`${API}/settings`));
  const defaults = JSON.parse(settings['notifications.emailDefaults']);
  expect(Object.keys(defaults).sort()).toEqual(Object.keys(DEFAULT_EMAIL_PREFS).sort());
  expect(defaults.assigned).toBe(false); // the stored choice wins
  expect(defaults.budget_warning).toBe(true); // an event the stored value never had
});
