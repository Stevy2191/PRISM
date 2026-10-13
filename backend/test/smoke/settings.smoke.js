const { resetData, closeDb, models, ROLE } = require('../integration/helpers');
const { API, expectOk, makeWorld, makeUser } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

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
// This file opens dozens of pages as one person; the API's limit (200
// requests a minute per user) is a backstop for real use, not for a test run.
beforeEach(resetRateLimits);

// A page in the Settings frame: breadcrumb, its title, no "Back to Settings".
const framed = async (page, path, title) => {
  resetRateLimits();
  await page.goto(path);
  const main = page.getByRole('main');
  try {
    await main.getByRole('navigation', { name: 'Breadcrumb' }).waitFor({ timeout: 10000 });
    await main.getByRole('heading', { level: 1, name: title }).waitFor({ timeout: 10000 });
  } catch (err) {
    throw new Error(`${path}: ${err.message}`);
  }
  expect([path, await page.getByText('Back to Settings').count()]).toEqual([path, 0]);
};

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
    await page.getByText('Saved', { exact: true }).waitFor();
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
    await page.getByText('Saved', { exact: true }).waitFor();
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
  it('You, Organization, People & access', async () => {
    const page = await as('admin');
    for (const [path, title] of [
      ['/settings/preferences', 'Preferences'], ['/settings/about', 'About PRISM'], ['/settings/companies', 'Companies & vendors'],
      ['/admin/users', 'Users'], ['/settings/teams', 'Teams'], ['/admin/departments', 'Departments'],
      ['/admin/roles', 'Roles & permissions'], ['/admin/roles/new', 'New role'], ['/admin/apikeys', 'API keys'],
    ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
  });
});

describe('Service desk and Hours & SLAs in the frame', () => {
  it('Service desk, Hours & SLAs', async () => {
    const page = await as('admin');
    for (const [path, title] of [
      ['/settings/statuses', 'Statuses'], ['/settings/layouts', 'Custom fields'], ['/admin/blueprints', 'Ticket templates'],
      ['/settings/assignment-rules', 'Assignment rules'], ['/settings/workflow-rules', 'Workflow rules'],
      ['/settings/workflow-rules/new', 'New workflow rule'], ['/settings/notifications', 'Notifications'],
      ['/settings/customer-happiness', 'Customer happiness'], ['/settings/slas', 'SLAs'],
      ['/settings/business-hours', 'Business hours'], ['/settings/holidays', 'Holidays'],
    ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
  });

  it('Notifications says when there are unsaved changes, then that they were saved', async () => {
    const page = await as('admin');
    await page.goto('/settings/notifications');
    await page.getByRole('main').getByRole('checkbox').first().click();
    await shown(page, 'Unsaved changes').waitFor();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
  });
});

describe('the rest in the frame, and every page opens', () => {
  it('Time & work, Assets, Sign-in & email, System', async () => {
    const page = await as('admin');
    for (const [path, title] of [
      ['/settings/time-tracking', 'Time tracking'], ['/settings/work-types', 'Work types'],
      ['/settings/asset-categories', 'Asset categories'], ['/settings/asset-alerts', 'Expiry alerts'],
      ['/settings/single-sign-on', 'Single sign-on'], ['/settings/directory', 'Directory (AD/LDAP)'],
      ['/settings/directory-sync', 'Directory sync'], ['/settings/incoming-email', 'Incoming email'],
      ['/settings/outgoing-email', 'Outgoing email'], ['/settings/email-log', 'Email log'],
      ['/settings/calendar-integration', 'Calendar'], ['/settings/modules', 'Modules & tabs'],
      ['/settings/schedules', 'Background jobs'], ['/settings/import', 'Import'], ['/settings/export', 'Export'],
      ['/settings/audit-log', 'Audit log'], ['/settings/system', 'System info'], ['/settings/company', 'Company profile'],
    ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
  });

  it('every menu page opens for an owner (no page is missing from the component map)', async () => {
    const page = await as('admin');
    await page.goto('/settings/preferences');
    await page.getByRole('complementary', { name: 'Settings menu' }).getByRole('link', { name: 'Time tracking' }).waitFor();
    const links = await page.getByRole('complementary', { name: 'Settings menu' }).getByRole('link').evaluateAll(
      (as) => as.map((a) => [a.getAttribute('href'), a.textContent.trim()]),
    );
    expect(links.length).toBeGreaterThan(35);
    for (const [href, name] of links.filter(([h]) => h !== '/settings')) {
      resetRateLimits();
      await page.goto(href); // eslint-disable-line no-await-in-loop
      await page.getByRole('main').getByRole('heading', { level: 1, name }).waitFor(); // eslint-disable-line no-await-in-loop
    }
  });

  it('Time tracking says when there are unsaved changes, then that they were saved', async () => {
    const page = await as('admin');
    await page.goto('/settings/time-tracking');
    await page.getByLabel('Longest time entry').selectOption('10');
    await shown(page, 'Unsaved changes').waitFor();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    expect(await setting('timeTracking.maxEntryHours')).toBe('10');
  });
});

describe('review fixes', () => {
  it('picking a page in the menu opens it at the top', async () => {
    const page = await as('admin');
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.goto('/settings/preferences');
    await page.getByRole('heading', { level: 1, name: 'Preferences' }).waitFor();
    await page.getByText('Reminders for running timers').waitFor();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.getByRole('complementary', { name: 'Settings menu' }).getByRole('link', { name: 'Time tracking' }).click();
    await page.waitForURL('**/settings/time-tracking');
    await page.getByRole('heading', { level: 1, name: 'Time tracking' }).waitFor();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  it('someone who can\'t open Users isn\'t offered "All users" on their own profile', async () => {
    const page = await as('staff1');
    const me = await models.User.findOne({ where: { username: 'staff1' } });
    await page.goto(`/admin/users/${me.id}`);
    await page.getByRole('main').getByRole('navigation', { name: 'Breadcrumb' }).waitFor();
    expect(await page.getByRole('link', { name: 'All users' }).count()).toBe(0);
    const admin = await as('admin');
    await admin.goto(`/admin/users/${me.id}`);
    await admin.getByRole('link', { name: 'All users' }).waitFor();
  });

  it('Directory sync names the Directory page, not General Settings', async () => {
    const page = await as('admin');
    await page.goto('/settings/directory-sync');
    await page.getByRole('heading', { level: 1, name: 'Directory sync' }).waitFor();
    expect(await page.getByText(/General Settings/).count()).toBe(0);
  });

  it('Company profile offers logo and favicon uploads only with the branding permission', async () => {
    const sys = await models.User.findOne({ where: { username: 'sysadmin2' } });
    expectOk(await w.admin.agent.post(`${API}/users/${sys.id}/overrides`).send({ permissionKey: 'settings.manage_branding', granted: false }), 201);
    const page = await as('sysadmin2');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    expect(await page.getByLabel('Upload logo').count()).toBe(0);
    await page.getByText(/Changing the logo and favicon needs the Branding permission/).waitFor();
    expect(await page.getByLabel('Organization name').isDisabled()).toBe(false);
  });
});
