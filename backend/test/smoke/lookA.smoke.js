const { resetData, closeDb } = require('../integration/helpers');
const {
  makeWorld, makeTicket, makeCompany, setSettings,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: the look A restyle. Shared pieces (the phone Filters sheet)
// and, for every restyled screen, no sideways page scroll at phone width.

const PHONE = { viewport: { width: 375, height: 812 } };
const LONG_COMPANY = 'Riverside Family Clinic and Associated Practices of the Greater Valley';

// { name, path, as = 'admin', before?: async (page) => void }; as: null is
// signed out; path may be a function of the seeded world.
const PHONE_ROUTES = [
  { name: 'tickets', path: '/tickets' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'assets', path: '/assets' },
  { name: 'contacts', path: '/contacts' },
  { name: 'a contact', path: () => `/contacts/${w.contact.id}` },
  { name: 'companies', path: '/companies' },
  { name: 'knowledge', path: '/knowledge' },
  { name: 'public Help Center', path: '/kb', as: null },
  { name: 'reports', path: '/reports' },
  { name: 'settings', path: '/settings' },
  { name: 'company profile', path: '/settings/company' },
  { name: 'users', path: '/admin/users' },
  { name: 'sign in', path: '/login', as: null },
  { name: 'change password', path: '/change-password' },
  { name: 'a long-named company', path: () => `/companies/${longCompany.id}` },
  { name: 'tickets board', path: '/tickets', before: (p) => p.getByRole('button', { name: 'Board' }).first().click() },
];

let smoke;
let w;
let longCompany;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  longCompany = await makeCompany(w.admin, { name: LONG_COMPANY });
  await makeTicket(w.admin.agent, { title: 'X'.repeat(200), contactId: w.contact.id, departmentId: w.deptA.id });
  await makeTicket(w.admin.agent, { title: 'Assigned board card', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: w.admin.user.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

async function phonePage(as = 'admin') {
  if (as === null) {
    const context = await smoke.browser.newContext({ baseURL: smoke.base, ...PHONE });
    return context.newPage();
  }
  return smoke.pageAs(as, undefined, PHONE);
}

it('Filters sheet: opens, traps Tab, Esc closes and focus returns', async () => {
  const page = await phonePage();
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Filters' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.waitFor();
  for (let i = 0; i < 15; i += 1) await page.keyboard.press('Tab'); // eslint-disable-line no-await-in-loop
  expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  expect(await page.evaluate(() => document.activeElement.textContent.trim())).toMatch(/^Filters/);
});

it('board cards name the assignee, or say Unassigned', async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1440, height: 900 } });
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Board' }).first().click();
  const assigned = page.locator('div.cursor-pointer').filter({ hasText: 'Assigned board card' });
  await assigned.getByText(w.admin.user.displayName, { exact: true }).waitFor();
  const unassigned = page.locator('div.cursor-pointer').filter({ hasText: 'X'.repeat(30) });
  await unassigned.getByText('Unassigned', { exact: true }).waitFor();
});

it('Filters sheet closes when the window widens past the phone layout', async () => {
  const page = await phonePage();
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('dialog', { name: 'Filters' }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  // A CSS locator, not getByRole: a display:none dialog would still be in
  // the DOM, holding Tab, and getByRole skips hidden elements.
  const dialog = page.locator('[role="dialog"][aria-label="Filters"]');
  await dialog.waitFor({ state: 'detached', timeout: 5000 });
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('[role="dialog"]'))).toBeNull();
});

it.each(PHONE_ROUTES.map((r) => [r.name, r]))('no horizontal page scroll at 375px: %s', async (_name, route) => {
  const page = await phonePage(route.as === undefined ? 'admin' : route.as);
  await page.goto(typeof route.path === 'function' ? route.path() : route.path);
  await page.waitForLoadState('networkidle');
  if (route.before) await route.before(page);
  await page.waitForTimeout(300);
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: document.documentElement.clientWidth,
  }));
  expect(widths.doc).toBeLessThanOrEqual(widths.win);
});

it('sign in shows the Company profile tagline and bullets', async () => {
  await setSettings(w.admin, { 'branding.tagline': 'Help, fast', 'branding.loginBullets': JSON.stringify(['Quick replies', 'Clear updates']) });
  const page = await phonePage(null);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByText('Help, fast').first().waitFor();
  await page.getByText('Quick replies').first().waitFor();
  await page.getByText('Clear updates').first().waitFor();
  await page.getByLabel('Username or email').waitFor();
  expect(await page.getByText(/^Authenticate$/i).count()).toBe(0);
});

it('restyled pages paint with the theme accent, not a fixed blue', async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1440, height: 900 } });
  for (const [path, name] of [['/reports', 'Export CSV'], ['/knowledge', /New article/], ['/tickets', /New Ticket/]]) {
    await page.goto(path); // eslint-disable-line no-await-in-loop
    await page.addStyleTag({ content: ':root, :root[data-theme] { --color-accent: #0f766e !important; }' }); // eslint-disable-line no-await-in-loop
    const el = page.getByRole(path === '/reports' ? 'button' : 'link', { name }).filter({ visible: true }).first();
    await el.waitFor(); // eslint-disable-line no-await-in-loop
    const css = await el.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, getComputedStyle(e).borderColor]); // eslint-disable-line no-await-in-loop
    if (path === '/reports') {
      // Export CSV is a default button; the accent shows on the selected preset pill's peers instead.
      const pill = page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: 'This month' });
      expect(await pill.getAttribute('aria-pressed')).toBe('true');
      const nav = page.getByRole('navigation', { name: 'Reports' }).getByRole('button', { name: 'Ticket Volume' });
      expect(await nav.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(15, 118, 110)');
    } else {
      expect(css[0]).toBe('rgb(15, 118, 110)');
    }
  }
});

// Opt-in: LOOK_SHOTS=1 OUT=dir screenshots every phone route at 1440 and 390,
// dark and light, for comparing against the mockups (docs/mockups/look-a-6b).
(process.env.LOOK_SHOTS ? describe : describe.skip)('screenshots', () => {
  it('captures every route', async () => {
    const out = process.env.OUT || '/tmp/look-a-shots';
    require('fs').mkdirSync(out, { recursive: true }); // eslint-disable-line global-require
    for (const theme of ['dark', 'light']) {
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        for (const route of PHONE_ROUTES) {
          resetRateLimits(); // dozens of sign-ins in one run
          const page = route.as === null
            ? await (await smoke.browser.newContext({ baseURL: smoke.base, viewport: { width, height } })).newPage() // eslint-disable-line no-await-in-loop
            : await smoke.pageAs(route.as || 'admin', undefined, { viewport: { width, height } }); // eslint-disable-line no-await-in-loop
          await page.context().addInitScript((t) => localStorage.setItem('prism.theme', t), theme); // eslint-disable-line no-await-in-loop
          await page.goto(typeof route.path === 'function' ? route.path() : route.path); // eslint-disable-line no-await-in-loop
          await page.waitForLoadState('networkidle'); // eslint-disable-line no-await-in-loop
          if (route.before) await route.before(page); // eslint-disable-line no-await-in-loop
          await page.screenshot({ path: `${out}/${route.name.replace(/\W+/g, '-')}-${width}-${theme}.png`, fullPage: true }); // eslint-disable-line no-await-in-loop
          await page.context().close(); // eslint-disable-line no-await-in-loop
        }
      }
    }
  }, 600000);
});
