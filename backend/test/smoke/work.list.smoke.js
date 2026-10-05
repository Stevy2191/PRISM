const { resetData, closeDb } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3a guard for the ticket list (table and board) and the new-ticket form.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeTicket(w.admin.agent, { title: 'Listed ticket', contactId: w.contact.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the table and the board both show the ticket', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await shown(page, 'Listed ticket').waitFor();
  await page.getByRole('button', { name: 'Board', exact: true }).filter({ visible: true }).first().click();
  await shown(page, 'Listed ticket').waitFor();
});

it('selecting a ticket shows the bulk action bar', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await shown(page, 'Listed ticket').waitFor();
  await page.locator('tr', { hasText: 'Listed ticket' }).filter({ visible: true }).locator('input[type=checkbox]').check();
  await shown(page, '1 selected').waitFor();
});

it('a ticket can be created from the new-ticket form', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/new?contactId=${w.contact.id}`);
  await shown(page, 'Casey Contact').waitFor();
  await page.locator('xpath=//label[normalize-space(text())="Title"]/following::input[1]').fill('Guard-created ticket');
  await page.getByRole('button', { name: 'Create Ticket' }).filter({ visible: true }).click();
  await page.waitForURL(/\/tickets\/\d+$/);
  await shown(page, 'Guard-created ticket').waitFor();
});
