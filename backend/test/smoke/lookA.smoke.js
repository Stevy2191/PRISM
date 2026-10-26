const { resetData, closeDb } = require('../integration/helpers');
const {
  makeWorld, makeTicket, makeCompany,
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
