const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeContact, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// A ticket filed under the wrong person: change its contact from the ticket.

let smoke;
let w;
let ticket;
let tom;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  tom = await makeContact(w.admin, { firstName: 'Tom', lastName: 'Becker', email: 'tom.becker@example.test' });
  ticket = await makeTicket(w.admin.agent, { title: 'Raised by someone else', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('Change in Contact Info moves the ticket to the person picked', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  const aside = page.locator('aside').filter({ hasText: 'Contact Info' }).first();
  await aside.getByRole('button', { name: 'Change', exact: true }).click();
  const box = aside.getByTestId('change-contact');
  await box.getByLabel("Change the ticket's contact").fill('Becker');
  const saved = page.waitForResponse((r) => r.url().endsWith(`/tickets/${ticket.id}`) && r.request().method() === 'PATCH');
  await box.getByRole('option', { name: /Tom Becker/ }).click();
  expect((await saved).status()).toBe(200);
  await aside.getByRole('link', { name: 'Tom Becker' }).waitFor();
  await aside.getByText('tom.becker@example.test').waitFor();
  expect((await models.Ticket.findByPk(ticket.id)).contactId).toBe(tom.id);
});
