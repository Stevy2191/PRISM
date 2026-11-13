const { resetData, closeDb, models } = require('../integration/helpers');
const { API, expectOk, makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The Tickets list: several statuses at once, saving that as a filter, and
// Clear filters.

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  const base = { contactId: w.contact.id, departmentId: w.deptA.id };
  await makeTicket(a, { ...base, title: 'Still open' });
  const held = await makeTicket(a, { ...base, title: 'Waiting on parts' });
  const onHold = await models.TicketStatus.findOne({ where: { behaviorType: 'on_hold' } });
  expectOk(await a.patch(`${API}/tickets/${held.id}`).send({ status: onHold.name }));
  const done = await makeTicket(a, { ...base, title: 'All done' });
  const closed = await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } });
  expectOk(await a.patch(`${API}/tickets/${done.id}`).send({ status: closed.name, resolution: 'Fixed' }));
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

const shown = (page, text) => page.getByRole('link', { name: text, exact: true }).filter({ visible: true });

it('Not closed, two statuses ticked, saved as a filter, then Clear filters', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await shown(page, 'All done').waitFor();

  const statusButton = page.getByRole('button', { name: /^Status:/ }).filter({ visible: true });
  await statusButton.click();
  await page.getByTestId('status-filter-menu').getByRole('button', { name: /Not closed/ }).click();
  await shown(page, 'All done').waitFor({ state: 'detached' });
  await shown(page, 'Still open').waitFor();
  await shown(page, 'Waiting on parts').waitFor();

  // Tick two: Open and On hold (all) — the same tickets, chosen by hand.
  await statusButton.click();
  const menu = page.getByTestId('status-filter-menu');
  await menu.getByRole('checkbox', { name: 'Open', exact: true }).check();
  await menu.getByRole('checkbox', { name: 'On hold (all)' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Status: Open, On hold' }).filter({ visible: true }).waitFor();
  await shown(page, 'Waiting on parts').waitFor();
  expect(await shown(page, 'All done').count()).toBe(0);

  // Save it, clear, and bring it back.
  await page.getByRole('button', { name: /Saved filters/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '+ Save current filter' }).click();
  await page.getByPlaceholder('Filter name').fill('My open tickets');
  const posted = page.waitForResponse((r) => r.url().endsWith('/saved-filters') && r.request().method() === 'POST');
  await page.getByPlaceholder('Filter name').press('Enter');
  expect((await posted).status()).toBe(201);
  const saved = await models.SavedFilter.findOne({ where: { name: 'My open tickets' } });
  expect(saved.filterJson.status).toEqual(['Open', 'on_hold']);

  // Close the Saved filters menu (it stays open after saving).
  await page.getByRole('button', { name: /Saved filters/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await shown(page, 'All done').waitFor();
  await page.getByRole('button', { name: 'Status: All statuses' }).filter({ visible: true }).waitFor();
  expect(await page.getByRole('button', { name: 'Clear filters' }).count()).toBe(0);
});
