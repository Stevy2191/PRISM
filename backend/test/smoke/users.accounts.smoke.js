const {
  resetData, closeDb, ROLE, models,
} = require('../integration/helpers');
const { makeWorld, makeUser, makeTech } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Creating an account with its role and overrides in one form, and changing
// usernames (user request 2026-10-11).

const { User, UserRole, UserPermissionOverride } = models;
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

it('an Owner creates a System Administrator with an override, in one form', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '+ New Local Account' }).click();
  await page.getByLabel('First name').fill('Dana');
  await page.getByLabel('Last name').fill('Reyes');
  await page.getByLabel('Username').fill('dana.reyes');
  await page.getByLabel('Temporary password').fill('Correct-Horse-Battery-9');
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'System Administrator' });
  await page.getByRole('button', { name: '+ Add override' }).click();
  await page.getByLabel('Permission', { exact: true }).selectOption('tickets.delete');
  await page.getByLabel('Grant or deny').selectOption('deny');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/admin\/users\/\d+$/);
  await shown(page, 'Dana Reyes').waitFor();

  const dana = await User.findOne({ where: { username: 'dana.reyes' } });
  expect(dana.role).toBe('admin');
  const sa = await models.Role.findOne({ where: { name: 'System Administrator' } });
  expect((await UserRole.findAll({ where: { userId: dana.id } })).map((r) => r.roleId)).toEqual([sa.id]);
  expect((await UserPermissionOverride.findAll({ where: { userId: dana.id }, raw: true })).map((o) => [o.permissionKey, !!o.granted]))
    .toEqual([['tickets.delete', false]]);
});

it('a System Administrator\'s form doesn\'t offer the top roles, and administrator rows have no delete', async () => {
  const page = await smoke.pageAs('sysadmin');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '+ New Local Account' }).click();
  const role = page.getByLabel('Role', { exact: true });
  await role.locator('option', { hasText: 'Department Staff' }).waitFor({ state: 'attached' });
  const options = await role.locator('option').allTextContents();
  expect(options).not.toContain('Owner');
  expect(options).not.toContain('System Administrator');
  // No row actions in the list any more: they're on the user's page, and
  // an administrator's page offers no delete or reset to a non-Owner.
  const adminRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'admin', exact: true }) });
  expect(await adminRow.getByRole('button').count()).toBe(0);
  await page.keyboard.press('Escape');
  await adminRow.getByRole('cell').nth(1).click(); // the row opens the user
  await page.waitForURL(/\/admin\/users\/\d+$/);
  await page.getByText("Only an Owner can change an administrator's account.").waitFor();
  expect(await page.getByRole('button', { name: 'Delete user' }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Reset password' }).isDisabled()).toBe(true);
});

it('Reset password and Delete user are on the user\'s page', async () => {
  const doomed = await makeTech('leaving-soon', w.deptA.id);
  const page = await smoke.pageAs('admin');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Temp-Pass-123') : d.accept()));
  await page.goto(`/admin/users/${doomed.user.id}`);
  const reset = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/users/${doomed.user.id}`));
  await page.getByRole('button', { name: 'Reset password' }).first().click();
  expect((await reset).status()).toBe(200);
  expect((await User.findByPk(doomed.user.id)).mustChangePassword).toBe(true);
  await page.getByRole('button', { name: 'Delete user' }).click();
  await page.waitForURL(/\/admin\/users$/);
  expect(await User.findByPk(doomed.user.id)).toBeNull();
  // Your own page offers no delete.
  await page.goto(`/admin/users/${w.admin.user.id}`);
  await page.getByRole('link', { name: 'All users' }).waitFor();
  expect(await page.getByRole('button', { name: 'Delete user' }).count()).toBe(0);
});

it('an Owner renames themselves from the profile', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/admin/users/${w.admin.user.id}`);
  const field = page.getByLabel('Username');
  await field.fill('sam.owner');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/users/${w.admin.user.id}`));
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await saved).status()).toBe(200);
  expect((await User.findByPk(w.admin.user.id)).username).toBe('sam.owner');
  // Still signed in under the new name.
  await page.reload();
  await page.getByLabel('Username').waitFor();
  expect(await page.getByLabel('Username').inputValue()).toBe('sam.owner');
});
