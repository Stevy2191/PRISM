const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeProject,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: one time log and one Log time form on tickets and projects — work
// type, billable, task, edit (including a duration-only entry) and delete.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();
const dialog = (page) => page.getByRole('dialog').filter({ visible: true }).last();

let smoke;
let w;
let ticket;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Time ticket', contactId: w.contact.id });
  project = await makeProject(w.admin.agent, { name: 'Time project', ownerDepartmentId: w.deptA.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 45, note: 'Plain duration' }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('logs time on a ticket with a work type and not billable', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  await button(page, 'Log time').click();
  const d = dialog(page);
  await d.getByLabel('Work type').selectOption({ label: 'On-site' });
  await d.getByLabel('Billable').uncheck();
  await d.getByLabel('Note').fill('Swapped the toner');
  const saved = page.waitForResponse((r) => r.url().includes(`/tickets/${ticket.id}/time`) && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Save time entry' }).click();
  await saved;
  await shown(page, 'Swapped the toner').waitFor();
  const { entries } = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`));
  expect(entries.find((e) => e.note === 'Swapped the toner')).toEqual(expect.objectContaining({ billable: false, workType: expect.objectContaining({ name: 'On-site' }) }));
});

it('edits a duration-only entry without inventing times', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  await page.getByRole('row', { name: /Plain duration/ }).getByRole('button', { name: 'Edit' }).click();
  const d = dialog(page);
  expect(await d.getByLabel('Minutes').inputValue()).toBe('45');
  await d.getByLabel('Minutes').fill('50');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/time/'));
  await d.getByRole('button', { name: 'Save time entry' }).click();
  await saved;
  const entry = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`)).entries.find((e) => e.note === 'Plain duration');
  expect([entry.durationSeconds, entry.startTime]).toEqual([3000, null]);
});

it('logs and deletes time on a project the same way', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('tab', { name: /^Time(?!line)/ }).filter({ visible: true }).first().click(); // the project page's look A tab strip
  await button(page, 'Log time').click();
  await dialog(page).getByLabel('Note').fill('Rack and stack');
  await dialog(page).getByRole('button', { name: 'Save time entry' }).click();
  await shown(page, 'Rack and stack').waitFor();
  page.once('dialog', (dlg) => dlg.accept());
  await page.getByRole('row', { name: /Rack and stack/ }).getByRole('button', { name: 'Delete' }).click();
  await shown(page, 'No time logged yet.').waitFor();
});
