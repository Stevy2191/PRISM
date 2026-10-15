const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, makeWorld, makeTech, makeTicket, makeTeam,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Service desk 5b desk tools in the browser: queue view + Take it, the merge
// dialog and banner, the recurring editor, and the canned-response picker.

const { Ticket, RecurringTicket } = models;
const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
let tina;
let page;
let desk;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  desk = await makeTeam(w.admin, 'Desk', [{ userId: tina.user.id }]);
  page = await smoke.pageAs('tina');
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('queue view lists team tickets and Take it assigns me', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'Queue printer', contactId: w.contact.id, departmentId: w.deptA.id, teamId: desk.id });
  await makeTicket(w.admin.agent, { title: 'Not my queue', contactId: w.contact.id, departmentId: w.deptA.id });
  await page.goto('/tickets');
  await page.getByTestId('queue-badge').first().waitFor();
  await page.getByTestId('queue-picker').selectOption('mine');
  await shown(page, 'Queue printer').waitFor();
  expect(await page.getByText('Not my queue').filter({ visible: true }).count()).toBe(0);
  const took = page.waitForResponse((r) => r.url().endsWith(`/tickets/${t.id}/take`));
  await page.getByRole('button', { name: 'Take it' }).filter({ visible: true }).first().click();
  expect((await took).status()).toBe(200);
  expect((await Ticket.findByPk(t.id)).assigneeId).toBe(tina.user.id);
});

it('merge dialog merges a ticket and the source shows the merged banner', async () => {
  const target = await makeTicket(w.admin.agent, { title: 'Merge target', contactId: w.contact.id, departmentId: w.deptA.id });
  const source = await makeTicket(w.admin.agent, { title: 'Merge source', contactId: w.contact.id, departmentId: w.deptA.id });
  await page.goto(`/tickets/${target.id}`);
  await page.getByRole('button', { name: 'Merge…' }).click();
  const dialog = page.getByTestId('merge-dialog');
  await dialog.getByLabel('Search tickets to merge').fill('Merge source');
  await dialog.getByText('Merge source').click();
  const merged = page.waitForResponse((r) => r.url().endsWith(`/tickets/${target.id}/merge`));
  await page.getByRole('button', { name: /Merge 1 into this ticket/ }).click();
  expect((await merged).status()).toBe(200);
  await page.goto(`/tickets/${source.id}`);
  const banner = page.getByTestId('merged-banner');
  await banner.waitFor();
  expect(await banner.textContent()).toContain(`#${String(target.id).padStart(5, '0')}`);
});

it('recurring editor shows five next runs and saves a rule', async () => {
  const admin = await smoke.pageAs('admin');
  await admin.goto('/settings/recurring-tickets/new');
  const editor = admin.getByTestId('recurring-editor');
  await editor.waitFor();
  await editor.getByLabel('Title').fill('Weekly backup check');
  await admin.getByPlaceholder(/Search contacts|Search by name/i).first().fill('Casey');
  await shown(admin, 'Casey Contact').click();
  await admin.getByRole('button', { name: 'Fri' }).click();
  const preview = admin.getByTestId('recurring-preview');
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid="recurring-preview"] li').length === 5);
  expect(await preview.locator('li').count()).toBe(5);
  const saved = admin.waitForResponse((r) => r.url().endsWith('/recurring-tickets') && r.request().method() === 'POST');
  await admin.getByRole('button', { name: 'Save' }).click();
  expect((await saved).status()).toBe(201);
  await shown(admin, 'Weekly backup check').waitFor();
  const rule = await RecurringTicket.findOne({ where: { title: 'Weekly backup check' } });
  expect(rule.weekdays).toEqual([1, 5]);
});

it('canned picker inserts a rendered response into the reply box', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'Canned printer', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tina.user.id });
  const agentRes = await page.context().request.post(`${API}/canned-responses`, { data: { title: 'Greeting', body: 'Hi {{contact.firstName}}, about #{{ticket.number}}' } });
  expect(agentRes.status()).toBe(201);
  await page.goto(`/tickets/${t.id}`);
  await page.getByRole('button', { name: 'Insert' }).click();
  await page.getByTestId('canned-picker').getByText('Greeting').click();
  const box = page.getByPlaceholder(/Reply to/);
  await expect_value(box, `Hi Casey, about #${String(t.id).padStart(5, '0')}`);
});

async function expect_value(locator, text) {
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if ((await locator.inputValue()) === text) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 100); });
  }
  expect(await locator.inputValue()).toBe(text);
}
