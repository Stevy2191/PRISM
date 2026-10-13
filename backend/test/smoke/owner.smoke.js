const { resetData, closeDb, ROLE } = require('../integration/helpers');
const { makeWorld, makeUser } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The Owner (user decision 2026-10-11): a System Administrator doesn't see
// the Owner-only settings, and sees an administrator's account read-only.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeUser('sysadmin', ROLE.ADMIN, w.deptA.id);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('a System Administrator doesn\'t get the Owner-only settings', async () => {
  const page = await smoke.pageAs('sysadmin');
  await page.goto('/settings/single-sign-on');
  await shown(page, /needs an Owner/).waitFor();
  await page.goto('/settings/directory');
  await shown(page, /needs an Owner/).waitFor();
  expect(await page.getByText('Active Directory / LDAP', { exact: true }).filter({ visible: true }).count()).toBe(0);
});

it('an Owner does', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/directory');
  await shown(page, 'Active Directory / LDAP').waitFor();
  await page.goto('/settings/outgoing-email');
  await page.getByRole('heading', { level: 1, name: 'Outgoing email' }).waitFor();
});

it('a System Administrator sees an administrator\'s account read-only', async () => {
  const page = await smoke.pageAs('sysadmin');
  await page.goto(`/admin/users/${w.admin.user.id}`);
  await shown(page, /Only an Owner can change an administrator.s account/).waitFor();
  expect(await page.getByRole('button', { name: '+ Assign role' }).filter({ visible: true }).count()).toBe(0);
});

// Ownership is a mark (user decision 2026-10-11): a crown for the owner, a
// star for a secondary owner; the owner's controls on an administrator's page.
it('a System Administrator gets no ownership controls', async () => {
  const page = await smoke.pageAs('sysadmin');
  await page.goto(`/admin/users/${w.admin.user.id}`);
  await shown(page, /Only an Owner can change an administrator.s account/).waitFor();
  expect(await page.getByRole('button', { name: 'Make secondary owner' }).count()).toBe(0);
});

it('the owner marks a secondary owner, then hands ownership over', async () => {
  const { User } = require('../integration/helpers').models; // eslint-disable-line global-require
  const sysadmin = await User.findOne({ where: { username: 'sysadmin' } });
  const page = await smoke.pageAs('admin');
  await page.goto('/admin/users');
  await page.getByRole('img', { name: 'Owner' }).first().waitFor();

  await page.goto(`/admin/users/${sysadmin.id}`);
  await page.getByRole('button', { name: 'Make secondary owner' }).click();
  await page.getByRole('button', { name: 'Remove secondary owner' }).waitFor();
  await shown(page, 'Secondary owner').waitFor();
  expect((await User.findByPk(sysadmin.id)).ownerLevel).toBe('secondary');

  await page.getByRole('button', { name: /Hand ownership to/ }).click();
  await page.getByLabel('Your password').fill('wrong-password');
  await page.getByRole('button', { name: 'Hand over ownership' }).click();
  await shown(page, 'Your password is incorrect').waitFor();
  await page.getByLabel('Your password').fill('IntegrationPass!2026');
  const handedOver = page.waitForResponse((r) => r.url().endsWith(`/users/${sysadmin.id}/owner/transfer`));
  await page.getByRole('button', { name: 'Hand over ownership' }).click();
  expect((await handedOver).status()).toBe(200);
  // After the reload, the former owner no longer gets the controls.
  await shown(page, /Only an Owner can change an administrator.s account/).waitFor();
  expect([(await User.findByPk(sysadmin.id)).ownerLevel, (await User.findByPk(w.admin.user.id)).ownerLevel]).toEqual(['owner', null]);
});
