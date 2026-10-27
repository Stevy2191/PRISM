const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeStaff,
} = require('../integration/fixtures');
const models = require('../../src/models');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: Knowledge in look A. On a phone the categories are a row of
// pills and Audience/Status sit behind Filters; desktop keeps the rail.

const PHONE = { viewport: { width: 375, height: 812 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

let smoke;
let w;
let vpnArticle;
const CATS = ['Network & VPN', 'Printers'];
// Knowledge rows outlive resetData: clear this file's own.
async function clearKb() {
  await models.KbArticle.destroy({ where: { title: ['Connect to the office VPN', 'Printer jams on envelopes', 'Printer setup draft'] } });
  await models.KbCategory.destroy({ where: { name: CATS } });
}
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await clearKb();
  w = await makeWorld();
  const a = w.admin.agent;
  const cat = async (name) => expectOk(await a.post(`${API}/knowledge/categories`).send({ name }), 201).category;
  const net = await cat('Network & VPN');
  const printers = await cat('Printers');
  const art = async (body) => expectOk(await a.post(`${API}/knowledge/articles`).send(body), 201).article;
  vpnArticle = await art({ title: 'Connect to the office VPN', body: '<p>Install FortiClient.</p>', categoryId: net.id, status: 'published', visibility: 'portal' });
  await art({ title: 'Printer jams on envelopes', body: '<p>Use tray 2.</p>', categoryId: printers.id, status: 'published' });
  await art({ title: 'Printer setup draft', body: '<p>Draft.</p>', categoryId: printers.id, status: 'draft' });
  const reader = await makeStaff('reader', w.deptA.id);
  expectOk(await a.post(`${API}/users/${reader.user.id}/overrides`).send({ permissionKey: 'kb.view', granted: true }), 201);
});
afterAll(async () => { await clearKb(); await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

const listed = (page, title) => page.getByRole('button', { name: new RegExp(title) }).filter({ visible: true });

it('phone: categories are a row of pills that filter the list', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto('/knowledge');
  const pills = page.getByRole('group', { name: 'Categories' });
  await pills.getByRole('button', { name: /All articles/ }).waitFor();
  await listed(page, 'Printer jams').first().waitFor();
  await pills.getByRole('button', { name: /^Network & VPN/ }).click();
  await listed(page, 'Printer jams').first().waitFor({ state: 'hidden' });
  await listed(page, 'Connect to the office VPN').first().waitFor();
});

it('phone: Audience and Status are behind Filters', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto('/knowledge');
  expect(await page.getByRole('combobox', { name: 'Status' }).filter({ visible: true }).count()).toBe(0);
  expect(await page.getByRole('combobox', { name: 'Audience' }).filter({ visible: true }).count()).toBe(0);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.getByRole('combobox', { name: 'Audience' }).waitFor();
  await sheet.getByRole('combobox', { name: 'Status' }).selectOption('draft');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await listed(page, 'Printer setup draft').first().waitFor();
  await listed(page, 'Printer jams').first().waitFor({ state: 'hidden' });
});

it('desktop keeps the category rail', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/knowledge');
  await page.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name: /^\S* ?Printers/ }).waitFor();
  expect(await page.getByRole('group', { name: 'Categories' }).filter({ visible: true }).count()).toBe(0);
});

it('without kb.manage there is no New article, Edit or Delete', async () => {
  const page = await smoke.pageAs('reader', undefined, DESKTOP);
  await page.goto('/knowledge');
  await listed(page, 'Connect to the office VPN').first().waitFor();
  expect(await page.getByRole('link', { name: /New article/ }).count()).toBe(0);
  await page.goto(`/knowledge/${vpnArticle.id}`);
  await page.getByRole('heading', { name: 'Connect to the office VPN' }).waitFor();
  expect(await page.getByRole('link', { name: /Edit/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Delete/ }).count()).toBe(0);
});

it('no articles shows the empty state', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/knowledge');
  await page.getByRole('textbox', { name: 'Search articles' }).fill('nothing-matches-this');
  await page.getByText('No articles here yet.').waitFor();
});

it('an article has a breadcrumb back to Knowledge Base', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/knowledge/${vpnArticle.id}`);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Knowledge Base' }).click();
  await page.waitForURL(/\/knowledge$/);
});

// The public Help Center moved into the client portal (7a): portal.smoke.js
// covers reading articles there; signed out, /kb now asks the contact to sign in.
it('the old public /kb address forwards to the portal sign-in', async () => {
  const context = await smoke.browser.newContext({ baseURL: smoke.base, ...PHONE });
  const page = await context.newPage();
  await page.goto('/kb');
  await page.waitForURL(/\/portal\/sign-in/);
  await context.close();
});

it('phone: a kb.manage user can still reach Manage categories', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto('/knowledge');
  await page.getByRole('button', { name: 'Manage categories' }).filter({ visible: true }).first().click();
  await page.getByRole('heading', { name: 'Manage categories' }).waitFor();
});
