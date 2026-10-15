const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Time waiting on the customer (user decisions 2026-10-15): the ticket page
// line, the report, and the per-status switch. Times are set directly in the
// database: the browser runs against the real clock.

const { Ticket, TicketActivity, TicketStatus } = models;
const ago = (min) => new Date(Date.now() - min * 60000);
const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
let page;
let waiting;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  // Open for an hour, then Waiting on User for an hour (still waiting).
  waiting = await makeTicket(w.admin.agent, {
    title: 'Waiting printer', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium',
  });
  expectOk(await w.admin.agent.patch(`${API}/tickets/${waiting.id}`).send({ status: 'Waiting on User' }));
  await Ticket.update({ createdAt: ago(120) }, { where: { id: waiting.id }, silent: true });
  await TicketActivity.update({ createdAt: ago(60) }, { where: { ticketId: waiting.id, action: 'status' } });
  page = await smoke.pageAs('admin');
});
afterAll(async () => {
  await TicketStatus.update({ countsAsWaiting: false }, { where: { name: 'On Hold' } });
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('the ticket page shows the time waiting on the customer', async () => {
  await page.goto(`/tickets/${waiting.id}`);
  const line = page.getByTestId('ticket-waiting');
  await line.waitFor();
  expect(await line.textContent()).toMatch(/Waiting on customer:\s*1h 0m \(50%\) · waiting now/);
});

it('the report shows the figures and can leave out open tickets', async () => {
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Waiting on Customer' }).first().click();
  await shown(page, 'Time waiting on customer').waitFor();
  await shown(page, 'Waiting printer').waitFor();
  await page.getByLabel('Closed tickets only').check();
  await shown(page, 'No tickets created in this period.').waitFor();
  expect(await page.getByText('Waiting printer').filter({ visible: true }).count()).toBe(0);
});

it('the Statuses page switches a status on and keeps Waiting on User on', async () => {
  await page.goto('/settings/statuses');
  const auto = page.getByLabel('Waiting on User counts as waiting on the customer');
  await auto.waitFor();
  expect(await auto.isChecked()).toBe(true);
  expect(await auto.isDisabled()).toBe(true);
  const saved = page.waitForResponse((r) => /\/ticket-statuses\/\d+$/.test(r.url()) && r.request().method() === 'PATCH');
  await page.getByLabel('On Hold counts as waiting on the customer').check();
  expect((await saved).status()).toBe(200);
  expect((await TicketStatus.findOne({ where: { name: 'On Hold' } })).countsAsWaiting).toBe(true);
});
