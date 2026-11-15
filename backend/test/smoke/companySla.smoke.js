const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Each company's SLA (CS part 2): set on the company's own page (Setup › SLA
// and hours), on Your company, and the starting values new companies copy.

const { SlaTarget, Holiday } = models;

let smoke;
let w;
let page;
let globex;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  globex = await makeCompany(w.admin, { name: 'Globex' });
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

const row = async (companyId) => models.SlaPolicy.findOne({ where: { companyId } });

it("an admin sets a customer's targets, support hours and a holiday on its page", async () => {
  await page.goto(`/companies/${globex.id}?tab=setup&part=sla`);
  const targets = page.getByRole('region', { name: 'SLA targets' });
  await targets.waitFor();
  await page.getByLabel('High resolved: amount').fill('4');
  await page.getByLabel('High resolved: unit').selectOption('hours');
  await targets.getByRole('button', { name: 'Request' }).click();
  await page.getByLabel('Low resolved: unit').selectOption('business_days');
  await page.getByLabel('Low resolved: amount').fill('20');
  await page.getByLabel('Around the clock').uncheck();
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  const saved = page.waitForResponse((r) => r.url().endsWith(`/companies/${globex.id}/sla`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.getByText('Saved', { exact: true }).waitFor();

  await page.getByLabel('Holiday name').fill('Founders day');
  await page.getByLabel('Holiday date').fill('2026-12-01');
  await page.getByRole('button', { name: 'Add a day' }).click();
  await page.getByRole('button', { name: 'Remove Founders day' }).waitFor();

  const sla = await row(globex.id);
  expect([sla.is24x7, sla.timezone]).toEqual([false, 'America/Chicago']);
  const target = (ticketType, priority) => SlaTarget.findOne({ where: { slaPolicyId: sla.id, ticketType, priority } });
  expect((await target('incident', 'high')).resolutionMinutes).toBe(240);
  const request = await target('request', 'low');
  expect([request.resolutionMinutes, request.resolutionUnit]).toEqual([20 * 1440, 'business_days']);
  expect(await Holiday.count({ where: { slaPolicyId: sla.id } })).toBe(1);
  // Your company's SLA is untouched.
  const own = await models.Company.findOne({ where: { isInternal: true } });
  expect((await SlaTarget.findOne({ where: { slaPolicyId: (await row(own.id)).id, ticketType: 'incident', priority: 'high' } })).resolutionMinutes).toBeNull();
});

it('Your company has the same SLA part', async () => {
  await page.goto('/settings/your-company?part=sla');
  await page.getByRole('region', { name: 'SLA targets' }).waitFor();
  await page.getByRole('region', { name: 'Support hours' }).waitFor();
  expect(await page.getByRole('button', { name: 'Reset to the starting values' }).count()).toBe(1);
});

it('the starting values are a page under Hours & SLAs, and a new company copies them', async () => {
  await page.goto('/settings/starting-values');
  await page.getByRole('heading', { level: 1, name: 'Starting values for new companies' }).waitFor();
  await page.getByLabel('Critical first response: amount').fill('30');
  await page.getByLabel('Critical first response: unit').selectOption('minutes');
  const saved = page.waitForResponse((r) => r.url().endsWith('/sla/starting-values') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect(await page.getByRole('button', { name: 'Reset to the starting values' }).count()).toBe(0);
  const initech = await makeCompany(w.admin, { name: 'Initech' });
  const sla = await row(initech.id);
  expect((await SlaTarget.findOne({ where: { slaPolicyId: sla.id, ticketType: 'incident', priority: 'critical' } })).responseMinutes).toBe(30);
  // Globex, made before, keeps its own.
  expect((await SlaTarget.findOne({ where: { slaPolicyId: (await row(globex.id)).id, ticketType: 'incident', priority: 'critical' } })).responseMinutes).toBe(60);
});

it('ticket statuses have no Pauses SLA switch', async () => {
  await page.goto('/settings/statuses');
  await page.getByRole('main').locator('li[draggable]').first().waitFor();
  expect(await page.getByText('Pauses SLA').count()).toBe(0);
});

it('the workflow editor offers the SLA triggers and clock, and no shared-policy action', async () => {
  await page.goto('/settings/workflow-rules/new');
  const trigger = page.getByRole('combobox').filter({ has: page.locator('option[value="sla_breached"]') });
  await trigger.selectOption('sla_breached');
  await page.getByLabel('Which SLA clock').selectOption('response');
  await page.getByRole('button', { name: '+ Add action' }).click();
  expect(await page.locator('option[value="set_sla_policy"]').count()).toBe(0);
});
