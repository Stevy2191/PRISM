const { resetData, closeDb, models, ROLE } = require('../integration/helpers');
const { API, expectOk, makeWorld, makeUser } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The Settings redesign (spec 2026-10-12): one menu, one page layout, the
// regrouped pages.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const setting = async (key) => (await models.SystemSettings.findOne({ where: { key } }))?.value;

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

// One sign-in per person (and screen size) for the whole file: the login
// limiter allows 10 per 15 minutes from one address.
const signedIn = new Map();
async function as(username, password, options) {
  const key = `${username} ${JSON.stringify(options || {})}`;
  if (!signedIn.has(key)) signedIn.set(key, await smoke.pageAs(username, password, options));
  return signedIn.get(key);
}

describe('Company profile', () => {
  it('holds what Company and Branding did, and saves a value from each panel', async () => {
    // Settings outlive resetData: start from known values.
    for (const [key, value] of [['company.name', 'Acme Corp'], ['company.timezone', 'UTC'], ['branding.appName', 'PRISM'], ['branding.tagline', '']]) {
      await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
    }
    const page = await as('admin');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    await page.getByLabel('Organization name').fill('Northwind IT');
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('App name').fill('Northwind Desk');
    await page.getByLabel('Login page tagline').fill('Help, fast');
    await shown(page, 'Unsaved changes').waitFor();
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith('/settings'));
    await page.getByRole('button', { name: 'Save' }).click();
    await saved;
    await shown(page, 'Saved').waitFor();
    expect([await setting('company.name'), await setting('company.timezone'), await setting('branding.appName'), await setting('branding.tagline')])
      .toEqual(['Northwind IT', 'America/Chicago', 'Northwind Desk', 'Help, fast']);
  });

  it('a branding-only user may change the logo but sees the text read-only', async () => {
    const brand = await makeUser('brand', ROLE.DEPARTMENT_STAFF, w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${brand.user.id}/overrides`).send({ permissionKey: 'settings.manage_branding', granted: true }), 201);
    const page = await as('brand');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    expect(await page.getByLabel('Organization name').isDisabled()).toBe(true);
    await shown(page, /Changing these needs the System settings permission/).waitFor();
    expect(await page.getByRole('button', { name: 'Save' }).count()).toBe(0);
    await page.getByText('Upload').first().waitFor();
  });

  it('the old Branding address opens Company profile', async () => {
    const page = await as('admin');
    await page.goto('/settings/branding');
    await page.waitForURL('**/settings/company');
  });
});

describe('System info', () => {
  it('has the upload limit, and the old General Settings address lands on Settings', async () => {
    // Settings outlive resetData: start from a known value.
    await models.SystemSettings.upsert({ key: 'system.maxAttachmentSizeMB', value: '25' });
    const page = await as('admin');
    await page.goto('/settings/system');
    await page.getByRole('heading', { level: 1, name: 'System info' }).waitFor();
    await page.getByLabel('Max attachment size (MB)').fill('30');
    await page.getByRole('button', { name: 'Save' }).click();
    await shown(page, 'Saved').waitFor();
    expect(await setting('system.maxAttachmentSizeMB')).toBe('30');
    await page.goto('/admin/settings');
    await page.waitForURL(/\/settings$/);
  });
});

describe('the menu', () => {
  let staff1; // made in the first test, reused: the login limiter allows 10 sign-ins per file
  const menu = (page) => page.getByRole('complementary', { name: 'Settings menu' });

  it('an owner sees every group; a System Administrator no Sign-in & email; Department Staff only a few', async () => {
    const groups = ['You', 'Organization', 'People & access', 'Service desk', 'Hours & SLAs', 'Time & work', 'Assets', 'Sign-in & email', 'System'];
    let page = await as('admin');
    await page.goto('/settings/preferences');
    for (const g of groups) await menu(page).getByText(g, { exact: true }).waitFor(); // eslint-disable-line no-await-in-loop
    await makeUser('sysadmin2', ROLE.ADMIN, w.deptA.id);
    page = await as('sysadmin2');
    await page.goto('/settings/preferences');
    await menu(page).getByText('Time & work', { exact: true }).waitFor();
    expect(await menu(page).getByText('Sign-in & email', { exact: true }).count()).toBe(0);
    staff1 = await makeUser('staff1', ROLE.DEPARTMENT_STAFF, w.deptA.id);
    page = await as('staff1');
    await page.goto('/settings/preferences');
    await menu(page).getByRole('link', { name: 'Preferences' }).waitFor();
    for (const hidden of ['Time tracking', 'Roles & permissions', 'Single sign-on', 'Import']) {
      expect([hidden, await menu(page).getByRole('link', { name: hidden }).count()]).toEqual([hidden, 0]); // eslint-disable-line no-await-in-loop
    }
  });

  it('marks the current page, including a detail page', async () => {
    const roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
    const page = await as('admin');
    await page.goto(`/admin/roles/${roles[0].id}`);
    await menu(page).locator('[aria-current="page"]', { hasText: 'Roles & permissions' }).waitFor();
  });

  it('someone with few pages can still open their own profile inside Settings', async () => {
    const page = await as('staff1');
    await page.goto(`/admin/users/${staff1.user.id}`);
    await menu(page).getByRole('link', { name: 'Preferences' }).waitFor();
  });

  it('search narrows the menu; Enter opens the first match; nothing matches safely', async () => {
    const page = await as('admin');
    await page.goto('/settings/preferences');
    const search = menu(page).getByLabel('Find a setting');
    await search.fill('logo');
    await menu(page).getByRole('link', { name: 'Company profile' }).waitFor();
    expect(await menu(page).getByRole('link', { name: 'Time tracking' }).count()).toBe(0);
    await search.press('Enter');
    await page.waitForURL('**/settings/company');
    await search.fill('([*');
    await menu(page).getByText('No settings match').waitFor();
    await search.press('Escape');
    await menu(page).getByRole('link', { name: 'Time tracking' }).waitFor();
  });

  it('old addresses land where they should', async () => {
    const page = await as('admin');
    for (const [from, to] of [['/settings/macros', /\/settings$/], ['/settings/recycle-bin', /\/settings$/], ['/settings/blueprints', /\/admin\/blueprints$/]]) {
      await page.goto(from); // eslint-disable-line no-await-in-loop
      await page.waitForURL(to); // eslint-disable-line no-await-in-loop
    }
  });

  it('on a phone the menu is behind "Settings menu", closes after picking, and nothing scrolls sideways', async () => {
    const page = await as('admin');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/settings/preferences');
    expect(await menu(page).isVisible()).toBe(false);
    await page.getByRole('button', { name: /Settings menu/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings menu' });
    await sheet.getByRole('link', { name: 'Time tracking' }).click();
    await page.waitForURL('**/settings/time-tracking');
    expect(await sheet.count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});

describe('Settings home', () => {
  it('lists the groups, searches, and shows status hints to an owner only', async () => {
    let page = await as('admin');
    await page.goto('/settings');
    const main = page.getByRole('main');
    await main.getByRole('heading', { level: 1, name: 'Settings' }).waitFor();
    await main.getByRole('heading', { name: 'Hours & SLAs' }).waitFor();
    await main.getByText('Not set up').first().waitFor(); // outgoing email in a fresh install
    await main.getByLabel('Search settings').fill('sla');
    await main.getByRole('link', { name: /SLAs/ }).first().waitFor();
    page = await as('sysadmin2');
    await page.goto('/settings');
    await page.getByRole('main').getByRole('heading', { name: 'Time & work' }).waitFor();
    expect(await page.getByRole('main').getByText('Not set up').count()).toBe(0);
  });
});

describe('every page uses the Settings frame', () => {
  const framed = async (page, path, title) => {
    await page.goto(path);
    const main = page.getByRole('main');
    await main.getByRole('navigation', { name: 'Breadcrumb' }).waitFor();
    await main.getByRole('heading', { level: 1, name: title }).waitFor();
    expect([path, await page.getByText('Back to Settings').count()]).toEqual([path, 0]);
  };
  it('You, Organization, People & access', async () => {
    const page = await as('admin');
    for (const [path, title] of [
      ['/settings/preferences', 'Preferences'], ['/settings/about', 'About PRISM'], ['/settings/companies', 'Companies & vendors'],
      ['/admin/users', 'Users'], ['/settings/teams', 'Teams'], ['/admin/departments', 'Departments'],
      ['/admin/roles', 'Roles & permissions'], ['/admin/roles/new', 'New role'], ['/admin/apikeys', 'API keys'],
    ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
  });
});
