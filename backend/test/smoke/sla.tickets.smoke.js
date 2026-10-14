const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeTech,
} = require('../integration/fixtures');
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
let tech;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  // The test seed has no resolution targets: set the ones these tickets use.
  const std = await models.SlaPolicy.findOne({ where: { isDefault: true } });
  expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({
    targets: [{ ticketType: 'request', priority: 'medium', responseMinutes: 480, resolutionMinutes: 1440 }],
  }));
  tech = await makeTech('tech', w.deptA.id);
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

describe('changing the due date', () => {
  it('a technician extends the due date with a reason and sees it on the ticket', async () => {
    const t = await makeTicket(w.admin.agent, { contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', title: 'Extend me' });
    const techPage = await smoke.pageAs('tech');
    await techPage.goto(`/tickets/${t.id}`);
    await techPage.getByTestId('sla-due-date').waitFor();
    expect(await techPage.getByRole('button', { name: 'Change due date' }).count()).toBe(0);
    await techPage.getByRole('button', { name: 'Extend due date' }).click();
    const dialog = techPage.getByRole('dialog');
    const current = (await models.Ticket.findByPk(t.id)).dueDate;
    const next = new Date(`${current}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 3);
    const later = next.toISOString().slice(0, 10);
    // No reason: refused in the dialog.
    await dialog.getByLabel('New due date').fill(later);
    await dialog.getByRole('button', { name: 'Extend' }).click();
    await dialog.getByText('Say why the due date is being extended.').waitFor();
    // Earlier: refused too.
    const earlier = new Date(`${current}T12:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - 1);
    await dialog.getByLabel('New due date').fill(earlier.toISOString().slice(0, 10));
    await dialog.getByLabel('Reason').fill('Waiting on parts');
    await dialog.getByRole('button', { name: 'Extend' }).click();
    await dialog.getByText('An extension must be later than the current due date.').waitFor();
    await dialog.getByLabel('New due date').fill(later);
    await dialog.getByRole('button', { name: 'Extend' }).click();
    await techPage.getByTestId('sla-due-changes').getByText('Waiting on parts').waitFor();
    await techPage.getByTestId('sla-original-due').waitFor();
    expect((await models.Ticket.findByPk(t.id)).dueDate).toBe(later);
  });

  it('an admin can move a due date earlier', async () => {
    const t = await makeTicket(w.admin.agent, { contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', title: 'Pull in' });
    await page.goto(`/tickets/${t.id}`);
    await page.getByRole('button', { name: 'Change due date' }).click();
    const dialog = page.getByRole('dialog');
    const current = (await models.Ticket.findByPk(t.id)).dueDate;
    await dialog.getByLabel('New due date').fill(current);
    await dialog.getByLabel('Reason (optional)').fill('Customer escalation');
    // Same day, earlier: change the hour via the picker's first select.
    await dialog.locator('select').first().selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('sla-due-changes').getByText('Customer escalation').waitFor();
  });

  it('at phone width the dialog fits the screen', async () => {
    const phone = await smoke.pageAs('admin', undefined, { viewport: { width: 375, height: 800 } });
    await phone.goto(`/tickets/${calm.id}`);
    await phone.getByRole('button', { name: 'Details' }).click(); // the sidebar is a sheet on phones
    await phone.getByRole('button', { name: 'Extend due date' }).click();
    await phone.getByRole('dialog').waitFor();
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
});

it('the report shows original SLA and extended due date figures', async () => {
  await page.goto('/reports');
  await page.getByRole('button', { name: 'SLA Compliance' }).first().click();
  await shown(page, 'Met the original SLA').waitFor();
  await shown(page, 'Met the due date (with extensions)').waitFor();
  await shown(page, 'Due date changes').waitFor();
});

async function expectGone(p, titles) {
  for (const t of titles) {
    // eslint-disable-next-line no-await-in-loop
    await p.getByText(t).filter({ visible: true }).first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    expect([t, await p.getByText(t).filter({ visible: true }).count()]).toEqual([t, 0]); // eslint-disable-line no-await-in-loop
  }
}
