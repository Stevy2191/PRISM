const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeProject, makeTask, makeSubtask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3b-1: today's ticket and project pages work on the unified task and
// time API (checklist toggle, time totals, project task and subtask toggles).

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
// The checkboxes are controlled: they flip once the PATCH comes back, so click
// and wait for it rather than using check(), which expects an instant flip.
const clickAndWait = async (page, box, urlPart) => {
  const patched = page.waitForResponse((r) => r.url().includes(urlPart) && r.request().method() === 'PATCH');
  await box.click();
  await patched;
};

let smoke;
let w;
let ticket;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Ledger ticket', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Toggle me' }), 201);
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 90, note: 'Ninety' }), 201);
  project = await makeProject(w.admin.agent, { name: 'Ledger project', ownerDepartmentId: w.deptA.id });
  const task = await makeTask(w.admin.agent, project.id, { title: 'Project task' });
  await makeSubtask(w.admin.agent, project.id, task.id, { title: 'Project subtask' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('a ticket checklist item ticks to Done and back', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  const box = page.locator('input[type=checkbox]').filter({ visible: true }).first();
  await clickAndWait(page, box, '/tasks/');
  const { tasks } = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`));
  expect(tasks[0].status.name).toBe('Done');
  await clickAndWait(page, box, '/tasks/');
  expect(expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks[0].status.name).toBe('To do');
});

it('the ticket\'s time tab shows the entry and the total', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  await shown(page, 'Ninety').waitFor();
  await shown(page, '1h 30m').waitFor();
});

it('a project subtask toggles closed from the task list', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Project task').click();
  await shown(page, 'Project subtask').waitFor();
  const before = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`)).tasks[0].subtasks[0];
  await clickAndWait(page, page.locator('input[type=checkbox]').filter({ visible: true }).last(), '/subtasks/');
  const after = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`)).tasks[0].subtasks[0];
  expect([before.completedAt, typeof after.completedAt]).toEqual([null, 'string']);
});
