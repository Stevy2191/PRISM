const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeProject, makeTask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: one task list on tickets and projects — a compact checklist that
// expands into the task's details, subtasks, time and a timer on the task.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let ticket;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Task ticket', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Replace drum' }), 201);
  project = await makeProject(w.admin.agent, { name: 'Task project', ownerDepartmentId: w.deptA.id });
  await makeTask(w.admin.agent, project.id, { title: 'First' });
  await makeTask(w.admin.agent, project.id, { title: 'Second' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('a ticket task expands: status, a subtask, and time on the task', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  await shown(page, 'Replace drum').click();
  const details = page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  const statusSaved = waitFor(page, 'PATCH', '/tasks/');
  await details.getByLabel('Status').selectOption({ label: 'In progress' });
  await statusSaved;
  await details.getByPlaceholder('Add a subtask…').fill('Order part');
  const subAdded = waitFor(page, 'POST', '/tasks');
  await details.getByPlaceholder('Add a subtask…').press('Enter');
  await subAdded;
  await details.getByRole('button', { name: 'Log time on this task' }).click();
  const dialog = page.getByRole('dialog').filter({ visible: true }).last();
  await dialog.getByLabel('Note').fill('Drum work');
  await dialog.getByRole('button', { name: 'Save time entry' }).click();
  await waitFor(page, 'POST', `/tickets/${ticket.id}/time`);
  const [task] = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks;
  expect([task.status.name, task.subtasks.map((s) => s.title), task.loggedSeconds > 0]).toEqual(['In progress', ['Order part'], true]);
});

it('a timer can run on a task', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  await shown(page, 'Replace drum').click();
  const details = page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  await details.getByRole('button', { name: 'Start timer', exact: true }).click();
  await waitFor(page, 'POST', '/timer/start');
  const [task] = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks;
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ type: 'ticket', taskId: task.id }));
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});

it('a subtask has its own timer and time; switching from the ticket timer keeps each minute where it was worked', async () => {
  const [task] = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks;
  const sub = task.subtasks.find((s) => s.title === 'Order part');
  // A ticket-level timer has been running ten minutes when the subtask timer starts.
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: ticket.id, label: 'Task ticket' }), 201);
  await models.ActiveTimer.update({ runningSince: new Date(Date.now() - 10 * 60 * 1000) }, { where: {} });
  const before = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`)).totalSeconds;
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  await shown(page, 'Replace drum').click();
  const details = page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  const row = details.getByRole('listitem').filter({ hasText: 'Order part' });
  await row.getByRole('button', { name: 'Start timer' }).click();
  const started = await waitFor(page, 'POST', '/timer/start');
  const { logged } = await started.json();
  // The ten minutes went to the ticket (no task), not to the subtask.
  expect([logged.taskId, logged.durationSeconds >= 600]).toEqual([null, true]);
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ taskId: sub.id }));
  // The ticket header showing it is checked in work.access.smoke.js (plan 3c Task 6).
  const after = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`)).totalSeconds;
  expect(after - before).toBe(logged.durationSeconds);
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});

it('the Time Entries tab breaks the time down by task and subtask', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  const breakdown = page.getByRole('region', { name: 'Time by task' }).filter({ visible: true }).first();
  await breakdown.getByText(/General/).waitFor();
  await breakdown.getByText('Replace drum').waitFor();
  await breakdown.getByText('Total').waitFor();
});

it('project tasks reorder with the move buttons', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Second').waitFor();
  const saved = waitFor(page, 'PATCH', '/tasks/reorder');
  await page.getByRole('button', { name: 'Move Second up' }).click();
  await saved;
  expect(expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`)).tasks.map((t) => t.title)).toEqual(['Second', 'First']);
});
