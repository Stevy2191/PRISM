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
  await page.goto('/settings');
  await shown(page, 'Roles & Permissions').waitFor();
  for (const label of ['Single Sign-On', 'Directory Sync', 'Calendar Integration']) {
    // eslint-disable-next-line no-await-in-loop
    expect([label, await page.getByText(label, { exact: true }).filter({ visible: true }).count()]).toEqual([label, 0]);
  }
  await page.goto('/settings/single-sign-on');
  await shown(page, /needs an Owner/).waitFor();
  await page.goto('/admin/settings');
  await shown(page, /Sign-in and mail settings can be changed only by an Owner/).waitFor();
  expect(await page.getByText('Active Directory / LDAP', { exact: true }).filter({ visible: true }).count()).toBe(0); // the section heading, not the notice
});

it('an Owner does', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings');
  await page.getByText('Single Sign-On', { exact: true }).filter({ visible: true }).first().waitFor();
  await page.goto('/admin/settings');
  await shown(page, 'Active Directory / LDAP').waitFor();
});

it('a System Administrator sees an administrator\'s account read-only', async () => {
  const page = await smoke.pageAs('sysadmin');
  await page.goto(`/admin/users/${w.admin.user.id}`);
  await shown(page, /Only an Owner can change an administrator.s account/).waitFor();
  expect(await page.getByRole('button', { name: '+ Assign role' }).filter({ visible: true }).count()).toBe(0);
});
