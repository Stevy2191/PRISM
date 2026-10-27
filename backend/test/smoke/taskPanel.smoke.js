const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, makeStaff,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { orgTimeZone, todayInZone } = require('../../src/utils/orgTime');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6, task 6: the docked task panel, quick time, the J/K/Esc keys
// and the shift-dependents banner.

const shown = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();
const panelOf = (page) => page.getByRole('complementary', { name: 'Task details' }).filter({ visible: true }).first();
const rowTitle = (page, title) => page.getByRole('button', { name: title, exact: true }).filter({ visible: true }).first();
const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let project;
let t1; let t2; let t3; let t4; let t5;
let helper;
let helperName;
let viewer;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  project = await makeProject(a, { name: 'Panel project', ownerDepartmentId: w.deptA.id });
  const phase = expectOk(await a.post(`${API}/projects/${project.id}/phases`).send({ name: 'Install' }), 201).phase;
  const mk = async (fields) => {
    const t = await makeTask(a, project.id, fields);
    expectOk(await a.patch(`${API}/projects/${project.id}/tasks/${t.id}`).send({ phaseId: phase.id }));
    return t;
  };
  t1 = await mk({ title: 'Firewall licence arrives', startDate: '2026-11-02', dueDate: '2026-11-05' });
  t2 = await mk({ title: 'Configure VLANs', startDate: '2026-11-06', dueDate: '2026-11-09' });
  t3 = await mk({ title: 'Install access points', startDate: '2026-11-10', dueDate: '2026-11-12' });
  t4 = await mk({ title: 'Test every jack', startDate: '2026-11-13', dueDate: '2026-11-16' });
  t5 = await mk({ title: 'Undated cleanup' });
  const link = (p, s) => a.post(`${API}/projects/${project.id}/dependencies`).send({ predecessorId: p.id, successorId: s.id });
  expectOk(await link(t1, t2), 201);
  expectOk(await link(t1, t3), 201);
  expectOk(await link(t1, t4), 201);
  expectOk(await link(t1, t5), 201);
  helper = await makeStaff('helper', w.deptA.id);
  helperName = (await models.User.findByPk(helper.user.id)).displayName;
  viewer = await makeStaff('viewer', w.deptA.id);
  await models.ProjectMember.create({ projectId: project.id, userId: viewer.user.id, role: 'helper' }); // helpers view and log time only
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

const open = async (page, title) => {
  await page.goto(`/projects/${project.id}`);
  await rowTitle(page, title).click();
  const panel = panelOf(page);
  await panel.waitFor();
  return panel;
};

it('clicking a task opens the panel and the list stays clickable', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Configure VLANs');
  expect(await panel.getByLabel('Task title').inputValue()).toBe('Configure VLANs');
  await panel.getByText('Waiting on', { exact: false }).first().waitFor();
  // The list is still there: another row opens in the same panel.
  await rowTitle(page, 'Install access points').click();
  await page.waitForFunction(() => document.querySelector('aside[aria-label="Task details"] input[aria-label="Task title"]')?.value === 'Install access points');
});

it('J/K move the selection, Esc closes', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Configure VLANs');
  const title = () => panel.getByLabel('Task title').inputValue();
  await page.keyboard.press('j');
  await page.waitForFunction(() => document.querySelector('aside[aria-label="Task details"] input[aria-label="Task title"]')?.value === 'Install access points');
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await page.waitForFunction(() => document.querySelector('aside[aria-label="Task details"] input[aria-label="Task title"]')?.value === 'Firewall licence arrives');
  expect(await title()).toBe('Firewall licence arrives');
  await page.keyboard.press('Escape');
  await panelOf(page).waitFor({ state: 'hidden' });
});

it('keys are ignored while typing in an input', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Configure VLANs');
  const input = panel.getByLabel('Task title');
  await input.focus();
  await page.keyboard.press('j');
  await page.keyboard.press('Escape');
  expect(await input.inputValue()).toBe('Configure VLANsj');
  await panelOf(page).waitFor();
  await input.fill('Configure VLANs'); // not saved: reset the draft
  await input.blur();
});

it('People field: Add a helper picks a person and shows them; helper can remove themselves', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Configure VLANs');
  await panel.getByRole('button', { name: 'Add a helper' }).click();
  const added = waitFor(page, 'POST', `/tasks/${t2.id}/helpers`);
  await panel.getByLabel('Choose a helper').selectOption({ label: helperName });
  await added;
  await panel.getByRole('button', { name: `Remove ${helperName}` }).waitFor();
  const hp = await smoke.pageAs('helper');
  const hpanel = await open(hp, 'Configure VLANs');
  // No edit controls for a helper, but their own chip can be removed.
  expect(await hpanel.getByLabel('Task title').count()).toBe(0);
  const removed = waitFor(hp, 'DELETE', `/tasks/${t2.id}/helpers/${helper.user.id}`);
  await hpanel.getByRole('button', { name: `Remove ${helperName}` }).click();
  await removed;
  await hpanel.getByRole('button', { name: `Remove ${helperName}` }).waitFor({ state: 'hidden' });
  expect(await models.TaskAssignee.count({ where: { taskId: t2.id } })).toBe(0);
});

it('30 min logs an entry for today on that task', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Configure VLANs');
  const logged = waitFor(page, 'POST', '/time-entries');
  await panel.getByRole('button', { name: '30 min', exact: true }).click();
  await logged;
  const [entry] = await models.TimeEntry.findAll({ where: { taskId: t2.id } });
  // "Today" is the organization's day (company time zone), not the test
  // machine's: in the evening they differ.
  const orgToday = todayInZone(await orgTimeZone());
  expect([entry.durationSeconds, entry.entryDate, entry.userId]).toEqual([1800, orgToday, w.admin.user.id]);
  expect(entry.workTypeId).toBeTruthy();
});

it('moving a due date later shows the banner; Move 3 tasks shifts them; Leave them dismisses', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Firewall licence arrives');
  const patched = waitFor(page, 'PATCH', `/tasks/${t1.id}`);
  const due = panel.getByLabel('Due date');
  await due.fill('2026-11-07');
  await due.blur();
  await patched;
  const banner = page.getByRole('alert').filter({ hasText: 'wait on it' }).filter({ visible: true }).first();
  // Three dated tasks wait on it; the undated one is not counted.
  await banner.getByText(/3 tasks wait on it/).waitFor();
  const shifted = waitFor(page, 'POST', `/tasks/${t1.id}/shift-dependents`);
  await banner.getByRole('button', { name: 'Move 3 tasks' }).click();
  await shifted;
  await banner.waitFor({ state: 'hidden' });
  const dates = async (t) => { const r = await models.Task.findByPk(t.id); return [r.startDate, r.dueDate]; };
  expect(await dates(t2)).toEqual(['2026-11-08', '2026-11-11']);
  expect(await dates(t4)).toEqual(['2026-11-15', '2026-11-18']);
  expect(await dates(t5)).toEqual([null, null]);
  // Move it again, then leave the others where they are.
  const again = waitFor(page, 'PATCH', `/tasks/${t1.id}`);
  await due.fill('2026-11-08');
  await due.blur();
  await again;
  const second = page.getByRole('alert').filter({ hasText: 'wait on it' }).filter({ visible: true }).first();
  await second.getByRole('button', { name: 'Leave them' }).click();
  await second.waitFor({ state: 'hidden' });
  expect(await dates(t2)).toEqual(['2026-11-08', '2026-11-11']);
});

it('view-only user sees no edit controls but can log time', async () => {
  const page = await smoke.pageAs('viewer');
  const panel = await open(page, 'Install access points');
  expect(await panel.getByLabel('Task title').count()).toBe(0);
  expect(await panel.getByLabel('Status').count()).toBe(0);
  expect(await panel.getByRole('button', { name: 'Add a helper' }).count()).toBe(0);
  const logged = waitFor(page, 'POST', '/time-entries');
  await panel.getByRole('button', { name: '15 min', exact: true }).click();
  await logged;
  const [entry] = await models.TimeEntry.findAll({ where: { taskId: t3.id } });
  expect([entry.durationSeconds, entry.userId]).toEqual([900, viewer.user.id]);
});

it('J/K and Esc are left alone while a dialog is open', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Configure VLANs');
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.id = 'fake-dialog';
    document.body.appendChild(d);
  });
  await page.keyboard.press('j');
  await page.keyboard.press('Escape');
  expect(await panel.getByLabel('Task title').inputValue()).toBe('Configure VLANs');
  await page.evaluate(() => document.getElementById('fake-dialog').remove());
  await page.keyboard.press('Escape');
  await panelOf(page).waitFor({ state: 'hidden' });
});

it('typing a date does not save until you leave the field', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Test every jack');
  let patches = 0;
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes(`/tasks/${t4.id}`)) patches += 1; });
  const due = panel.getByLabel('Due date');
  await due.focus();
  for (const v of ['0002-11-20', '0020-11-20', '0202-11-20']) await due.fill(v);
  expect(patches).toBe(0);
  const saved = waitFor(page, 'PATCH', `/tasks/${t4.id}`);
  await due.fill('2026-11-30');
  await due.blur();
  await saved;
  expect(patches).toBe(1);
  expect((await models.Task.findByPk(t4.id)).dueDate).toBe('2026-11-30');
});

it('the activity list reaches past the latest 25 project rows', async () => {
  const a = w.admin.agent;
  for (let i = 0; i < 28; i += 1) {
    expectOk(await a.patch(`${API}/projects/${project.id}/tasks/${t5.id}`).send({ title: `Noise ${i}` }));
  }
  expectOk(await a.patch(`${API}/projects/${project.id}/tasks/${t5.id}`).send({ title: 'Undated cleanup' }));
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Firewall licence arrives');
  await panel.getByText('Nothing yet.').waitFor({ state: 'hidden' });
  await panel.getByText(/created a task|edited a task/).first().waitFor();
});

it('at 800px wide the panel is an overlay and the list title column stays readable', async () => {
  const page = await smoke.pageAs('admin');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(`/projects/${project.id}`);
  const title = rowTitle(page, 'Configure VLANs');
  const before = (await title.boundingBox()).width;
  await title.click();
  const panel = panelOf(page);
  await panel.waitFor();
  const box = await panel.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(780);
  await page.keyboard.press('Escape');
  await panelOf(page).waitFor({ state: 'hidden' });
  expect((await title.boundingBox()).width).toBeGreaterThanOrEqual(before - 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await rowTitle(page, 'Configure VLANs').click();
  await panelOf(page).waitFor();
  expect((await rowTitle(page, 'Configure VLANs').boundingBox()).width).toBeGreaterThan(100);
});

it('a later save of the same task with no offer clears the shift banner', async () => {
  const page = await smoke.pageAs('admin');
  const panel = await open(page, 'Firewall licence arrives');
  const first = waitFor(page, 'PATCH', `/tasks/${t1.id}`);
  const due = panel.getByLabel('Due date');
  const current = (await models.Task.findByPk(t1.id)).dueDate;
  const later = new Date(`${current}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 1);
  await due.fill(later.toISOString().slice(0, 10));
  await due.blur();
  await first;
  const banner = page.getByRole('alert').filter({ hasText: 'wait on it' }).filter({ visible: true }).first();
  await banner.waitFor();
  const second = waitFor(page, 'PATCH', `/tasks/${t1.id}`);
  await panel.getByLabel('Priority').selectOption('high');
  await second;
  await banner.waitFor({ state: 'hidden' });
});
