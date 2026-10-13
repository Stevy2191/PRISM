const { resetData, closeDb, models } = require('./helpers');
const { API, makeWorld } = require('./fixtures');
const { sendMail } = require('../../src/services/emailSender');

// Messages that send people to a Settings page name pages that exist (the
// Settings redesign split General Settings up).

const SMTP_KEYS = ['smtp.host', 'smtp.fromEmail'];
let w;
beforeEach(async () => {
  await resetData();
  await models.SystemSettings.destroy({ where: { key: SMTP_KEYS } });
  w = await makeWorld();
});
afterAll(closeDb);

it('running Directory sync without a directory points to Settings → Directory (AD/LDAP)', async () => {
  const res = await w.admin.agent.post(`${API}/ad-sync/run`);
  expect([res.status, res.body.code, res.body.message])
    .toEqual([400, 'LDAP_NOT_CONFIGURED', 'The directory is not set up yet (Settings → Directory (AD/LDAP))']);
});

it('sending mail without outgoing email set up points to Settings → Outgoing email', async () => {
  await expect(sendMail({ to: 'a@example.com', subject: 'x', text: 'x' }))
    .rejects.toThrow('Outgoing email is not set up yet (Settings → Outgoing email)');
});
