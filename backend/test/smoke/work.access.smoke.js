const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: the ticket page follows what the server allows (Department Staff
// on an unassigned department ticket: view, comment, log own time; no edits),
// and runs on the one server timer.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

let smoke;
let w;
let ticket;
let other;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeStaff('staff', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Not mine', contactId: w.contact.id, departmentId: w.deptA.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Locked task' }), 201);
  other = await makeTicket(w.admin.agent, { title: 'Other ticket', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('staff see the ticket read-only but can log their own time', async () => {
  const page = await smoke.pageAs('staff');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, 'Not mine').waitFor();
  await shown(page, 'View only').waitFor();
  expect(await page.getByLabel('Priority').filter({ visible: true }).first().isDisabled()).toBe(true);
  await tab(page, /^Tasks/);
  expect(await page.getByPlaceholder('Add a task…').count()).toBe(0);
  await tab(page, /^Time Entries/);
  await button(page, 'Log time').waitFor();
  await tab(page, /^Relationships/);
  expect(await page.getByRole('button', { name: /Link ticket/ }).filter({ visible: true }).count()).toBe(0);
});

it('the ticket timer is the server timer, pauses, and stops into the Log time form', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await button(page, 'Start timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/start'));
  await button(page, 'Pause timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/pause'));
  await button(page, 'Stop timer').click();
  const dialog = page.getByRole('dialog').filter({ visible: true }).last();
  await dialog.getByRole('button', { name: 'Keep timing' }).waitFor();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await page.waitForResponse((r) => r.url().includes('/timer/stop'));
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toBeNull();
});

it('a timer on another ticket is named on this one, and starting here logs it', async () => {
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: other.id, label: 'Other ticket' }), 201);
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, /Timer running on Other ticket/).waitFor();
  await button(page, 'Start timer').click();
  const started = await page.waitForResponse((r) => r.url().includes('/timer/start'));
  expect((await started.json()).logged).toEqual(expect.objectContaining({ ticketId: other.id }));
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});

it('the ticket header shows a timer running on one of its subtasks, with Pause and Stop', async () => {
  const task = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Parent task' }), 201).task;
  const sub = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Order part', parentTaskId: task.id }), 201).task;
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: ticket.id, taskId: sub.id, label: 'Not mine · Order part' }), 201);
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, /on Order part/).waitFor();
  await button(page, 'Pause timer').waitFor();
  await button(page, 'Stop timer').waitFor();
  expect(await page.getByRole('button', { name: 'Start timer', exact: true }).filter({ visible: true }).count()).toBe(0);
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});
