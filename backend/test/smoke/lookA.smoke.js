const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeCompany, setSettings,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: the look A restyle. Shared pieces (the phone Filters sheet)
// and, for every restyled screen, no sideways page scroll at phone width.

const PHONE = { viewport: { width: 375, height: 812 } };
const LONG_COMPANY = 'Riverside Family Clinic and Associated Practices of the Greater Valley';
const LONG = 'Front desk shared workstation for the east wing reception and billing team';
const CAT = 'Look A overflow laptops';
const KB_TITLE = `${LONG} — how to sign in`;

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
  { name: 'a ticket with a 200-character title', path: () => `/tickets/${seeded.ticket.id}` },
  { name: 'new ticket', path: '/tickets/new' },
  { name: 'an asset', path: () => `/assets/${seeded.asset.id}` },
  { name: 'a license', path: () => `/assets/licenses/${seeded.license.id}` },
  { name: 'a contract', path: () => `/assets/contracts/${seeded.contract.id}` },
  { name: 'a knowledge article', path: () => `/knowledge/${seeded.article.id}` },
  { name: 'licenses', path: '/assets/licenses' },
  { name: 'contracts', path: '/assets/contracts' },
];

let smoke;
let w;
let longCompany;
const seeded = {};
// Asset categories and knowledge rows outlive resetData: clear this file's own.
async function clearOwn() {
  await models.KbArticle.destroy({ where: { title: KB_TITLE } });
  await models.Asset.destroy({ where: { assetTag: 'LT-LONG-0001' }, force: true });
  await models.AssetCategory.destroy({ where: { name: CAT } });
}
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await clearOwn();
  w = await makeWorld();
  longCompany = await makeCompany(w.admin, { name: LONG_COMPANY });
  const a = w.admin.agent;
  seeded.ticket = await makeTicket(a, { title: 'X'.repeat(200), contactId: w.contact.id, departmentId: w.deptA.id });
  const category = await models.AssetCategory.create({ name: CAT });
  seeded.asset = expectOk(await a.post(`${API}/assets`).send({ categoryId: category.id, name: LONG, assetTag: 'LT-LONG-0001', serialNumber: 'SN'.repeat(30) }), 201).asset;
  seeded.license = expectOk(await a.post(`${API}/licenses`).send({ name: LONG, vendor: LONG_COMPANY, totalSeats: 25 }), 201).license;
  seeded.contract = expectOk(await a.post(`${API}/contracts`).send({ name: LONG, vendor: LONG_COMPANY }), 201).contract;
  seeded.article = expectOk(await a.post(`${API}/knowledge/articles`).send({ title: KB_TITLE, body: `<p>${'word '.repeat(80)}</p>`, status: 'published' }), 201).article;
  await makeTicket(w.admin.agent, { title: 'Assigned board card', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: w.admin.user.id });
});
afterAll(async () => { await clearOwn(); await smoke.stop(); await closeDb(); });
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
  // Full-height pages clip with overflow:hidden, which hides overflow from
  // scrollWidth: also look for any visible element poking past the right
  // edge that isn't inside a sideways scroller.
  const poking = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > vw + 1 && !inScroller(el);
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 40)}"`);
  });
  expect(poking).toEqual([]);
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
