const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Timers (plan 3c; several at once, user decision 2026-10-12): they start
// from a page, pause and resume, show in "My timers" on any page, remind the
// user about ones left running, and follow automatic mode from ticket to ticket.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();
const timers = async () => expectOk(await w.admin.agent.get(`${API}/timer`)).timers; // eslint-disable-line no-use-before-define
const backdate = (minutes, where = {}) => {
  const at = new Date(Date.now() - minutes * 60 * 1000);
  return models.ActiveTimer.update({ startedAt: at, runningSince: at }, { where });
};

let smoke;
let w;
let project;
let T1;
let T2;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  project = await makeProject(w.admin.agent, { name: 'Timer project', ownerDepartmentId: w.deptA.id });
  T1 = await makeTicket(w.admin.agent, { title: 'First ticket', contactId: w.contact.id });
  T2 = await makeTicket(w.admin.agent, { title: 'Second ticket', contactId: w.contact.id });
});
afterEach(async () => {
  await models.ActiveTimer.destroy({ where: {} });
  await models.User.update({ timerMode: 'manual', timerReminderMinutes: 120 }, { where: { id: w.admin.user.id } });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
// Each test loads several pages; the per-user request limit (200/min) is
// for people, not a browser run.
beforeEach(resetRateLimits);

it('starts, pauses, resumes and shows in the top bar', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await button(page, 'Start timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/start'));
  expect(await timers()).toEqual([expect.objectContaining({ type: 'project', id: project.id, state: 'running' })]);
  await button(page, 'Pause timer').click();
  await page.waitForResponse((r) => /\/timer\/\d+\/pause/.test(r.url()));
  expect((await timers())[0].state).toBe('paused');
  await button(page, 'Resume timer').click();
  await page.waitForResponse((r) => /\/timer\/\d+\/resume/.test(r.url()));
  await page.goto('/tickets');
  await button(page, /My timers: 1 timer running/).waitFor();
});

it('My timers lists every timer; stopping one opens Log time, and the others keep running', async () => {
  for (const t of [T1, T2]) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: t.id, label: t.title }), 201);
  }
  await backdate(20);
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await button(page, /My timers: 2 timers running/).click();
  const list = page.getByRole('dialog', { name: 'My timers' });
  await list.getByRole('link', { name: 'First ticket' }).waitFor();
  await list.getByRole('link', { name: 'Second ticket' }).waitFor();
  await list.getByRole('button', { name: 'Stop and log First ticket' }).click();
  const form = page.getByRole('dialog', { name: 'Log time' });
  const logged = page.waitForResponse((r) => r.request().method() === 'POST' && /\/timer\/\d+\/stop/.test(r.url()));
  await form.getByRole('button', { name: 'Save time entry' }).click();
  await logged;
  expect(await models.TimeEntry.count({ where: { ticketId: T1.id } })).toBe(1);
  expect((await timers()).map((t) => [t.id, t.state])).toEqual([[T2.id, 'running']]);
});

it('a timer left running gets a "still working?" popup, once across reloads; Pause pauses it', async () => {
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: T1.id, label: 'First ticket' }), 201);
  await backdate(125);
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  const popup = page.getByRole('dialog', { name: 'Still working on these?' });
  await popup.getByText('First ticket').waitFor();
  const paused = page.waitForResponse((r) => /\/timer\/\d+\/pause/.test(r.url()));
  await popup.getByRole('button', { name: 'Pause' }).click();
  await paused;
  expect((await timers())[0].state).toBe('paused');
  // Shown once for this stretch: a reload with the timer running again doesn't repeat it.
  expectOk(await w.admin.agent.post(`${API}/timer/${(await timers())[0].timerId}/resume`));
  await page.reload();
  await button(page, /My timers/).waitFor();
  await page.waitForTimeout(1000);
  expect(await popup.count()).toBe(0);
});

it('no popup when reminders are off', async () => {
  await models.User.update({ timerReminderMinutes: 0 }, { where: { id: w.admin.user.id } });
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: T1.id, label: 'First ticket' }), 201);
  await backdate(600);
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await button(page, /My timers/).waitFor();
  await page.waitForTimeout(1000);
  expect(await page.getByRole('dialog', { name: 'Still working on these?' }).count()).toBe(0);
});

it('a timer at the limit says so and offers no Resume', async () => {
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: T1.id, label: 'First ticket' }), 201);
  await backdate(13 * 60);
  await models.User.update({ timerReminderMinutes: 0 }, { where: { id: w.admin.user.id } });
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await button(page, /My timers: 1 timer paused/).click();
  await shown(page, 'paused at the 12-hour limit').waitFor();
  expect(await page.getByRole('button', { name: 'Resume First ticket' }).count()).toBe(0);
});

it('automatic mode starts the next ticket\'s timer when moving from one ticket to another', async () => {
  await models.User.update({ timerMode: 'automatic', timerPromptBeforeLog: false }, { where: { id: w.admin.user.id } });
  const page = await smoke.pageAs('admin');
  const startedOn = (t) => page.waitForResponse((r) => r.url().includes('/timer/start') && r.request().postDataJSON().id === t.id);
  const first = startedOn(T1);
  await page.goto(`/tickets/${T1.id}`);
  await first;
  const second = startedOn(T2);
  await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, `/tickets/${T2.id}`);
  await second;
  await page.waitForTimeout(500);
  expect((await timers()).map((t) => t.id)).toEqual([T2.id]);
});
