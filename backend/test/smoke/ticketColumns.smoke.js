const { resetData, closeDb } = require('../integration/helpers');
const { makeWorld, makeTech, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The Tickets list's columns follow the technician's account, not the browser.

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeTech('tina', w.deptA.id);
  await makeTech('omar', w.deptA.id);
  await makeTicket(w.admin.agent, { title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

const header = (page, name) => page.getByRole('columnheader', { name, exact: true });

it('a column chosen in one browser is there in another for the same person, and not for someone else', async () => {
  const first = await smoke.pageAs('tina');
  await first.goto('/tickets');
  await header(first, 'Requester').waitFor();
  expect(await header(first, 'Source').count()).toBe(0);
  await first.getByRole('button', { name: 'Columns' }).click();
  const saved = first.waitForResponse((r) => r.url().includes('/preferences/tickets.columns') && r.request().method() === 'PUT');
  await first.getByRole('checkbox', { name: 'Source' }).check();
  expect((await saved).status()).toBe(200);
  await header(first, 'Source').waitFor();

  // A second browser, nothing stored in it.
  const second = await smoke.pageAs('tina');
  await second.goto('/tickets');
  await header(second, 'Source').waitFor();

  const other = await smoke.pageAs('omar');
  await other.goto('/tickets');
  await header(other, 'Requester').waitFor();
  expect(await header(other, 'Source').count()).toBe(0);
});
