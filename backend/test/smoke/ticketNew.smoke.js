const { resetData, closeDb } = require('../integration/helpers');
const { makeWorld } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: the new ticket form in three groups. Same fields, same
// required ones.

let smoke;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await makeWorld();
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it("New ticket groups fields under The problem, Who it's for, Who's on it", async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1440, height: 900 } });
  await page.goto('/tickets/new');
  const problem = page.getByRole('group', { name: 'The problem' });
  await problem.getByRole('textbox', { name: 'Title' }).waitFor();
  await problem.getByRole('textbox', { name: 'Description' }).waitFor();
  await problem.getByRole('combobox', { name: 'Priority' }).waitFor();
  await page.getByRole('group', { name: "Who it's for" }).getByPlaceholder('Search contacts by name or email…').waitFor();
  await page.getByRole('group', { name: "Who's on it" }).getByRole('combobox', { name: 'Assignee' }).waitFor();

  // Title is still required: the browser blocks the empty submit.
  await page.getByRole('button', { name: 'Create Ticket' }).filter({ visible: true }).click();
  expect(await problem.getByRole('textbox', { name: 'Title' }).evaluate((el) => el.validity.valueMissing)).toBe(true);
  expect(page.url()).toMatch(/\/tickets\/new$/);
});

it('required fields say so to screen readers', async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1440, height: 900 } });
  await page.goto('/tickets/new');
  const customer = page.getByRole('group', { name: "Who it's for" }).locator('label', { hasText: 'Customer' }).first();
  expect(await customer.textContent()).toContain('(required)');
  await page.getByRole('textbox', { name: 'Title (required)' }).waitFor();
});
