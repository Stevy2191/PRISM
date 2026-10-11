const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c's final review: the screen findings fixed in its one fix pass.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let A;
let B;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  A = await makeTicket(w.admin.agent, { title: 'Ticket A', contactId: w.contact.id });
  B = await makeTicket(w.admin.agent, { title: 'Ticket B', contactId: w.contact.id });
});
afterEach(async () => {
  await models.ActiveTimer.destroy({ where: {} });
  await models.User.update({ timerMode: 'manual' }, { where: { id: w.admin.user.id } });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('C1: automatic mode leaves a timer running elsewhere alone', async () => {
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: B.id, label: 'Ticket B' }), 201);
  await models.User.update({ timerMode: 'automatic' }, { where: { id: w.admin.user.id } });
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${A.id}`);
  await shown(page, /Timer running on Ticket B/).waitFor();
  await page.waitForTimeout(1500); // give a wrongful start time to happen
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ id: B.id }));
  expect(await models.TimeEntry.count({ where: { ticketId: B.id } })).toBe(0);
});

it('the banner for a timer elsewhere stops and logs it, or discards it', async () => {
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: B.id, label: 'Ticket B' }), 201);
  await models.ActiveTimer.update({ runningSince: new Date(Date.now() - 5 * 60 * 1000) }, { where: {} });
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${A.id}`);
  const stopped = waitFor(page, 'POST', '/timer/stop');
  await page.getByRole('button', { name: 'Stop & log' }).click();
  await stopped;
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toBeNull();
  expect(await models.TimeEntry.count({ where: { ticketId: B.id } })).toBe(1);
});

it('I2: editing an entry keeps its times, in any browser time zone', async () => {
  const { entry } = expectOk(await w.admin.agent.post(`${API}/tickets/${A.id}/time`).send({
    startTime: '2026-03-10T15:00:00.000Z', endTime: '2026-03-10T15:30:00.000Z', entryDate: '2026-03-10', note: 'Fixed span',
  }), 201);
  // A browser zone that is not this host's (the server may run on UTC).
  const page = await smoke.pageAs('admin', undefined, { timezoneId: 'Asia/Tokyo' });
  await page.goto(`/tickets/${A.id}`);
  await tab(page, /^Time Entries/);
  await page.getByRole('row', { name: /Fixed span/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog').filter({ visible: true }).last();
  await dialog.getByLabel('Note').fill('Fixed span, edited');
  const saved = waitFor(page, 'PATCH', '/time/');
  await dialog.getByRole('button', { name: 'Save time entry' }).click();
  await saved;
  const after = expectOk(await w.admin.agent.get(`${API}/tickets/${A.id}/time`)).entries.find((e) => e.id === entry.id);
  expect([after.startTime, after.endTime]).toEqual(['2026-03-10T15:00:00.000Z', '2026-03-10T15:30:00.000Z']);
});

describe('tasks', () => {
  let task;
  let subA;
  let subB;
  beforeAll(async () => {
    task = expectOk(await w.admin.agent.post(`${API}/tickets/${A.id}/tasks`).send({ title: 'Parent' }), 201).task;
    subA = expectOk(await w.admin.agent.post(`${API}/tickets/${A.id}/tasks`).send({ title: 'Sub A', parentTaskId: task.id }), 201).task;
    subB = expectOk(await w.admin.agent.post(`${API}/tickets/${A.id}/tasks`).send({ title: 'Sub B', parentTaskId: task.id }), 201).task;
  });
  const openTask = async (page) => {
    await page.goto(`/tickets/${A.id}`);
    await tab(page, /^Tasks/);
    await shown(page, 'Parent').click();
    return page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  };

  it('I3: switching the timer between subtasks updates each subtask\'s time at once', async () => {
    expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: A.id, taskId: subA.id, label: 'Sub A' }), 201);
    await models.ActiveTimer.update({ runningSince: new Date(Date.now() - 10 * 60 * 1000) }, { where: {} });
    const page = await smoke.pageAs('admin');
    const details = await openTask(page);
    const rowA = details.getByRole('listitem').filter({ hasText: 'Sub A' });
    await details.getByRole('listitem').filter({ hasText: 'Sub B' }).getByRole('button', { name: 'Start timer on Sub B' }).click();
    await rowA.getByTitle('Time on this subtask').filter({ hasText: /10m|11m/ }).waitFor();
  });

  it('a draft subtask survives the task reloading, and subtasks renumber', async () => {
    const page = await smoke.pageAs('admin');
    const details = await openTask(page);
    await details.getByPlaceholder('Add a subtask…').fill('Draft that should stay');
    const saved = waitFor(page, 'PATCH', '/tasks/');
    await details.getByLabel('Description').fill('Changed');
    await details.getByLabel('Description').blur();
    await saved;
    await page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/tickets/${A.id}/tasks`));
    expect(await details.getByPlaceholder('Add a subtask…').inputValue()).toBe('Draft that should stay');
    await details.getByRole('listitem').filter({ hasText: 'Sub B' }).getByTitle('Click to renumber').waitFor();
    expect(subB.code).toMatch(/-S\d+$/);
  });
});
