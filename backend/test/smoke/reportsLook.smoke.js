const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6b: Reports in look A. On a phone the date presets are a row of
// pills and Department/Company/Assignee sit behind Filters.

const PHONE = { viewport: { width: 375, height: 812 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const volume = (r) => r.url().includes('/api/v1/reports/ticket-volume');
const startOf = (r) => new URL(r.url()).searchParams.get('startDate');

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeTicket(w.admin.agent, { title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id });
  const noExport = await makeTech('noexport', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${noExport.user.id}/overrides`).send({ permissionKey: 'reports.export', granted: false }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('phone: presets are a row of pills; Department, Company and Assignee are behind Filters', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto('/reports');
  const presets = page.getByRole('group', { name: 'Date range' });
  const thisMonth = presets.getByRole('button', { name: 'This month' });
  await thisMonth.waitFor();
  expect(await thisMonth.getAttribute('aria-pressed')).toBe('true');
  expect(await page.getByRole('combobox', { name: 'Department' }).filter({ visible: true }).count()).toBe(0);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('dialog', { name: 'Filters' }).getByRole('combobox', { name: 'Department' }).waitFor();
});

it('phone: picking Last month changes the range', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  const first = page.waitForResponse(volume);
  await page.goto('/reports');
  const thisMonthStart = startOf(await first);
  const next = page.waitForResponse((r) => volume(r) && startOf(r) !== thisMonthStart);
  await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: 'Last month' }).click();
  const lastMonthStart = startOf(await next);
  expect(lastMonthStart < thisMonthStart).toBe(true);
  expect(lastMonthStart.endsWith('-01')).toBe(true);
});

it('the report name is a heading', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/reports');
  await page.getByRole('heading', { name: 'Ticket Volume' }).waitFor();
  await page.getByRole('button', { name: 'Export CSV' }).waitFor();
});

it('without reports.export there is no Export CSV', async () => {
  const page = await smoke.pageAs('noexport', undefined, DESKTOP);
  await page.goto('/reports');
  await page.getByRole('heading', { name: 'Ticket Volume' }).waitFor();
  expect(await page.getByRole('button', { name: 'Export CSV' }).count()).toBe(0);
});

it('a report with no data shows No data.', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Custom range' }).filter({ visible: true }).first().click();
  const loaded = page.waitForResponse((r) => volume(r) && startOf(r) === '2099-01-01');
  await page.getByLabel('From', { exact: true }).fill('2099-01-01');
  await page.getByLabel('To', { exact: true }).fill('2099-01-31');
  await loaded;
  await page.getByText('No data.').first().waitFor();
});
