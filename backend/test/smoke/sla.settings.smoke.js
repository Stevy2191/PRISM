const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// SLA engine settings screens (sub-project 4): the policy editor, the
// Pauses SLA switch on statuses, and the SLA workflow trigger and action.

const { SlaPolicy, SlaTarget, TicketStatus } = models;

let smoke;
let w;
let page;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeCompany(w.admin, { name: 'Globex' });
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('an admin creates a policy with targets and a company, and sees it listed', async () => {
  await page.goto('/settings/slas');
  await page.getByRole('heading', { level: 1, name: 'SLAs' }).waitFor();
  await page.getByRole('button', { name: '+ New policy' }).click();
  await page.getByLabel('Name').fill('Gold');
  await page.getByLabel('Urgent Assign within minutes').fill('15');
  await page.getByLabel('Urgent First response within hours').fill('1');
  await page.getByLabel('Urgent Resolve within hours').fill('4');
  await page.getByLabel('Urgent Resolve within minutes').fill('30');
  await page.getByLabel('Globex').check();
  await page.getByRole('button', { name: 'Save policy' }).click();
  const card = page.getByTestId('sla-policy').filter({ hasText: 'Gold' });
  await card.waitFor();
  await card.getByText('Globex').waitFor();

  const gold = await SlaPolicy.findOne({ where: { name: 'Gold' } });
  const urgent = await SlaTarget.findOne({ where: { slaPolicyId: gold.id, priority: 'critical' } });
  expect([urgent.assignMinutes, urgent.responseMinutes, urgent.resolutionMinutes]).toEqual([15, 60, 270]);
  const low = await SlaTarget.findOne({ where: { slaPolicyId: gold.id, priority: 'low' } });
  expect(low.resolutionMinutes).toBeNull();
});

it('the default policy cannot be deleted', async () => {
  await page.goto('/settings/slas');
  const standard = page.getByTestId('sla-policy').filter({ hasText: 'Standard' });
  await standard.waitFor();
  expect(await standard.getByRole('button', { name: 'Delete' }).isDisabled()).toBe(true);
});

it('the Pauses SLA switch on a ticket status saves', async () => {
  const status = await TicketStatus.create({ name: 'Waiting on vendor', behaviorType: 'open', position: 98 });
  try {
    await page.goto('/settings/statuses');
    const box = page.getByLabel('Waiting on vendor pauses SLA');
    await box.waitFor();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/ticket-statuses/${status.id}`) && r.request().method() === 'PATCH'),
      box.click(),
    ]);
    expect((await TicketStatus.findByPk(status.id)).pausesSla).toBe(true);
    expect(await box.isChecked()).toBe(true);
  } finally {
    await status.destroy();
  }
});

it('the workflow editor offers the SLA triggers, clock and Set SLA policy action', async () => {
  await page.goto('/settings/workflow-rules/new');
  const trigger = page.getByRole('combobox').filter({ has: page.locator('option[value="sla_breached"]') });
  await trigger.selectOption('sla_breached');
  await page.getByLabel('Which SLA clock').selectOption('response');
  await page.getByRole('button', { name: '+ Add action' }).click();
  const action = page.getByRole('combobox').filter({ has: page.locator('option[value="set_sla_policy"]') });
  await action.selectOption('set_sla_policy');
  const policy = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Select SLA policy…' }) });
  expect(await policy.getByRole('option', { name: 'Standard' }).count()).toBe(1);
});
