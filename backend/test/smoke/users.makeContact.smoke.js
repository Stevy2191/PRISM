const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeTech } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// "Make contact" on a user's page (2026-10-27).

let smoke; let w; let tina;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  await models.User.update({ email: 'tina.smoke@acme.example', displayName: 'Tina Tech' }, { where: { id: tina.user.id } });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('makes a contact from the user, then links to it', async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1280, height: 900 } });
  await page.goto(`/admin/users/${tina.user.id}`);
  await page.getByRole('button', { name: 'Make contact' }).click();
  await page.getByRole('status').filter({ hasText: 'Contact created.' }).waitFor();
  const contact = await models.Contact.findOne({ where: { email: 'tina.smoke@acme.example' } });
  expect(contact.displayName).toBe('Tina Tech');
  await page.getByRole('link', { name: 'Open contact' }).click();
  await page.waitForURL(new RegExp(`/contacts/${contact.id}$`));
  // Coming back, the page knows the contact exists.
  await page.goto(`/admin/users/${tina.user.id}`);
  await page.getByRole('link', { name: 'Open contact' }).waitFor();
  expect(await page.getByRole('button', { name: 'Make contact' }).count()).toBe(0);
  await page.context().close();
});

it('someone without people.edit_users sees no button on their own profile', async () => {
  const page = await smoke.pageAs('tina', undefined, { viewport: { width: 375, height: 812 } });
  await page.goto(`/admin/users/${tina.user.id}`);
  await page.getByText('Tina Tech').first().waitFor();
  expect(await page.getByRole('button', { name: 'Make contact' }).count()).toBe(0);
  await page.context().close();
});
