const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// SLA on the ticket page, the ticket list, the dashboard and the SLA
// compliance report (sub-project 4). Clock states are set directly in the
// database: the browser runs against the real clock.

const { TicketSla } = models;
const ago = (min) => new Date(Date.now() - min * 60000);
const ahead = (min) => new Date(Date.now() + min * 60000);
const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
let page;
let breached;
let risky;
let calm;
let legacy;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const base = { contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium' };
  breached = await makeTicket(w.admin.agent, { ...base, title: 'Breached printer' });
  risky = await makeTicket(w.admin.agent, { ...base, title: 'Risky scanner' });
  calm = await makeTicket(w.admin.agent, { ...base, title: 'Calm monitor' });
  legacy = await makeTicket(w.admin.agent, { ...base, title: 'Legacy fax' });
  await TicketSla.update(
    { responseDueAt: ago(30), responseWarnAt: ago(60), responseWarnedAt: ago(60), responseBreachedAt: ago(30) },
    { where: { ticketId: breached.id } }
  );
  await TicketSla.update({ responseWarnAt: ago(5), responseDueAt: ahead(25) }, { where: { ticketId: risky.id } });
  await TicketSla.destroy({ where: { ticketId: legacy.id } });
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('the ticket page shows the SLA clocks with due times', async () => {
  await page.goto(`/tickets/${calm.id}`);
  const response = page.getByTestId('sla-clock-response');
  await response.waitFor();
  expect(await response.textContent()).toMatch(/First response.*target 8h.*left · due/);
  expect(await page.getByTestId('sla-clock-resolution').textContent()).toMatch(/Resolution.*target 24h/);
  await shown(page, 'Policy: Standard').waitFor();
});

it('a ticket from before SLAs shows No SLA', async () => {
  await page.goto(`/tickets/${legacy.id}`);
  await shown(page, 'No SLA (created before SLAs were tracked)').waitFor();
});

it('the list filters to breached and at-risk tickets', async () => {
  await page.goto('/tickets');
  await shown(page, 'Calm monitor').waitFor();
  await page.getByRole('button', { name: 'SLA breached' }).click();
  await shown(page, 'Breached printer').waitFor();
  await expectGone(page, ['Calm monitor', 'Risky scanner']);
  await page.getByRole('button', { name: 'SLA at risk' }).click();
  await shown(page, 'Risky scanner').waitFor();
  await expectGone(page, ['Calm monitor', 'Breached printer']);
});

it('the dashboard lists breached and at-risk tickets, most urgent first', async () => {
  await page.goto('/');
  const panel = page.getByTestId('sla-at-risk');
  await panel.waitFor();
  const items = await panel.locator('li').allTextContents();
  expect(items.map((t) => (t.includes('Breached printer') ? 'breached' : t.includes('Risky scanner') ? 'risky' : t))).toEqual(['breached', 'risky']);
});

it('the report shows the per-clock figures', async () => {
  await page.goto('/reports');
  await page.getByRole('button', { name: 'SLA Compliance' }).first().click();
  await shown(page, 'First response on time').waitFor();
  await shown(page, 'Open and breached').waitFor();
});

it('at phone width the SLA panel and list badge fit the screen', async () => {
  const phone = await smoke.pageAs('admin', undefined, { viewport: { width: 375, height: 800 } });
  for (const path of [`/tickets/${breached.id}`, '/tickets']) {
    await phone.goto(path); // eslint-disable-line no-await-in-loop
    await phone.waitForLoadState('networkidle'); // eslint-disable-line no-await-in-loop
    // eslint-disable-next-line no-await-in-loop
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect([path, overflow]).toEqual([path, 0]);
  }
  await phone.getByTestId('sla-badge').first().waitFor();
});

async function expectGone(p, titles) {
  for (const t of titles) {
    // eslint-disable-next-line no-await-in-loop
    await p.getByText(t).filter({ visible: true }).first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    expect([t, await p.getByText(t).filter({ visible: true }).count()]).toEqual([t, 0]); // eslint-disable-line no-await-in-loop
  }
}
