const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// SLA engine settings screens (sub-project 4): the policy editor, the
// Pauses SLA switch on statuses, and the SLA workflow trigger and action.

const { SlaPolicy, SlaTarget } = models;

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

it('an admin sets Request/Low to 20 days and Incident/High to 4 hours, with a company', async () => {
  await page.goto('/settings/slas');
  await page.getByRole('heading', { level: 1, name: 'SLAs' }).waitFor();
  await page.getByRole('button', { name: '+ New policy' }).click();
  await page.getByLabel('Name').fill('Gold');
  await page.getByLabel('Incident High Resolve within amount').fill('4');
  await page.getByLabel('Incident High Resolve within unit').selectOption('hours');
  await page.getByLabel('Incident High Assign within amount').fill('15');
  await page.getByLabel('Incident High Assign within unit').selectOption('minutes');
  await page.getByRole('tab', { name: 'Request' }).click();
  await page.getByLabel('Request Low Resolve within amount').fill('20');
  await page.getByLabel('Request Low Resolve within unit').selectOption('days');
  await page.getByLabel('Globex').check();
  await page.getByRole('button', { name: 'Save policy' }).click();
  const card = page.getByTestId('sla-policy').filter({ hasText: 'Gold' });
  await card.waitFor();
  await card.getByText('Globex').waitFor();
  await card.getByText('20d').waitFor();

  const gold = await SlaPolicy.findOne({ where: { name: 'Gold' } });
  const target = (ticketType, priority) => SlaTarget.findOne({ where: { slaPolicyId: gold.id, ticketType, priority } });
  const incident = await target('incident', 'high');
  expect([incident.resolutionMinutes, incident.resolutionUnit, incident.assignMinutes]).toEqual([240, 'minutes', 15]);
  const request = await target('request', 'low');
  expect([request.resolutionMinutes, request.resolutionUnit]).toEqual([20, 'business_days']);
  expect((await target('problem', 'low')).resolutionMinutes).toBeNull();
});

it('the default policy cannot be deleted', async () => {
  await page.goto('/settings/slas');
  const standard = page.getByTestId('sla-policy').filter({ hasText: 'Standard' });
  await standard.waitFor();
  expect(await standard.getByRole('button', { name: 'Delete' }).isDisabled()).toBe(true);
});

it('ticket statuses have no Pauses SLA switch', async () => {
  await page.goto('/settings/statuses');
  await page.getByRole('main').locator('li[draggable]').first().waitFor();
  expect(await page.getByText('Pauses SLA').count()).toBe(0);
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
