const { resetData, closeDb } = require('../integration/helpers');
const {
  makeWorld, makeTicket, makeStaff,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: the ticket page in look A. On a phone, Link ticket, Merge
// and Generate report move into a "More actions" menu, and the reply box
// starts as one line.

const PHONE = { viewport: { width: 375, height: 812 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const ACTIONS = ['Link ticket', 'Merge…', 'Generate report'];

let smoke;
let w;
let t;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeStaff('viewer', w.deptA.id); // sees the department's tickets, can't edit them
  t = await makeTicket(w.admin.agent, { title: 'Outlook keeps asking for a password', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

async function open(as, view) {
  const page = await smoke.pageAs(as, undefined, view);
  await page.goto(`/tickets/${t.id}`);
  await page.getByRole('heading', { name: t.title }).waitFor();
  return page;
}

it('Link ticket, Merge and Generate report are in the More actions menu on a phone', async () => {
  const page = await open('admin', PHONE);
  for (const name of ACTIONS) {
    // eslint-disable-next-line no-await-in-loop
    expect(await page.getByRole('button', { name, exact: true }).filter({ visible: true }).count()).toBe(0);
  }
  await page.getByRole('button', { name: 'More actions' }).click();
  const menu = page.getByRole('menu');
  for (const name of ACTIONS) {
    // eslint-disable-next-line no-await-in-loop
    await menu.getByRole('menuitem', { name, exact: true }).waitFor();
  }
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Link ticket' }).click();
  await page.getByRole('heading', { name: 'Link ticket' }).waitFor();
});

it('the reply box starts as one line and expands on tap', async () => {
  const page = await open('admin', PHONE);
  const reply = page.getByRole('textbox', { name: 'Reply' });
  await reply.waitFor();
  expect(await page.getByRole('button', { name: /^Send/ }).filter({ visible: true }).count()).toBe(0);
  await reply.click();
  await page.getByRole('button', { name: /^Send/ }).filter({ visible: true }).first().waitFor();
});

it('desktop keeps Link ticket, Merge and Generate report as buttons', async () => {
  const page = await open('admin', DESKTOP);
  for (const name of ACTIONS) {
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().waitFor();
  }
  expect(await page.getByRole('button', { name: 'More actions' }).filter({ visible: true }).count()).toBe(0);
  await page.getByRole('button', { name: /^Send/ }).filter({ visible: true }).first().waitFor();
});

it('a view-only user sees no Edit title, Link ticket or Merge', async () => {
  const page = await open('viewer', DESKTOP);
  expect(await page.getByRole('button', { name: 'Edit title' }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Link ticket', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Merge…', exact: true }).count()).toBe(0);
});
