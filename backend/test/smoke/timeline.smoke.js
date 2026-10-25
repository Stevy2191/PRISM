const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, makeStaff,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6, task 7: the Timeline tab (drag, resize, zoom, phone).

const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));
const bar = (page, task) => page.locator(`[data-task-id="${task.id}"]`);
const dates = async (t) => { const r = await models.Task.findByPk(t.id); return [r.startDate, r.dueDate]; };

let smoke;
let w;
let project;
let t1; let t2; let t3; let t4; let t5;
let viewer;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  project = await makeProject(a, { name: 'Timeline project', ownerDepartmentId: w.deptA.id });
  const phase = expectOk(await a.post(`${API}/projects/${project.id}/phases`).send({ name: 'Install' }), 201).phase;
  const mk = async (fields) => {
    const t = await makeTask(a, project.id, fields);
    expectOk(await a.patch(`${API}/projects/${project.id}/tasks/${t.id}`).send({ phaseId: phase.id }));
    return t;
  };
  t1 = await mk({ title: 'Firewall licence arrives', startDate: '2026-11-02', dueDate: '2026-11-05' });
  t2 = await mk({ title: 'Configure VLANs', startDate: '2026-11-06', dueDate: '2026-11-09' });
  t3 = await mk({ title: 'Install access points', startDate: '2026-11-10', dueDate: '2026-11-12' });
  t4 = await mk({ title: 'Undated cleanup' });
  t5 = await mk({ title: 'One day job', startDate: '2026-11-17', dueDate: '2026-11-17' });
  const link = (p, s) => a.post(`${API}/projects/${project.id}/dependencies`).send({ predecessorId: p.id, successorId: s.id });
  expectOk(await link(t1, t2), 201);
  expectOk(await link(t1, t3), 201);
  viewer = await makeStaff('viewer', w.deptA.id);
  await models.ProjectMember.create({ projectId: project.id, userId: viewer.user.id, role: 'member' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

const openTimeline = async (page) => {
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('[data-timeline-scroll]').waitFor();
};

const dragBy = async (page, locator, dx, fromX = 0.5) => {
  const box = await locator.boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width * fromX;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y);
  await page.mouse.move(x + dx, y);
  await page.mouse.up();
};

it('dragging a bar 2 days saves new dates and shows the shift banner when it has dependents', async () => {
  const page = await smoke.pageAs('admin');
  await openTimeline(page);
  const patched = waitFor(page, 'PATCH', `/tasks/${t1.id}`);
  await dragBy(page, bar(page, t1), 24); // month zoom: 12 px a day
  await patched;
  const banner = page.getByRole('alert').filter({ hasText: 'wait on it' }).filter({ visible: true }).first();
  await banner.getByText(/2 tasks wait on it/).waitFor();
  expect(await dates(t1)).toEqual(['2026-11-04', '2026-11-07']);
  const shifted = waitFor(page, 'POST', `/tasks/${t1.id}/shift-dependents`);
  const reloaded = Promise.all([waitFor(page, 'GET', `/projects/${project.id}/phases`), waitFor(page, 'GET', `/projects/${project.id}/tasks`)]);
  await banner.getByRole('button', { name: 'Move 2 tasks' }).click();
  await shifted;
  await reloaded; // the bars redraw from the reloaded tasks
  await page.waitForTimeout(200);
  expect(await dates(t2)).toEqual(['2026-11-08', '2026-11-11']);
  // Resize the right end back by one day; the bar start stays put.
  const resized = waitFor(page, 'PATCH', `/tasks/${t3.id}`);
  const handle = bar(page, t3).locator('[data-handle="end"]');
  await dragBy(page, handle, -12);
  await resized;
  expect(await dates(t3)).toEqual(['2026-11-12', '2026-11-13']);
});

it('a dependency arrow renders between two linked tasks', async () => {
  const page = await smoke.pageAs('admin');
  await openTimeline(page);
  await bar(page, t1).waitFor();
  await page.locator('svg g path').nth(1).waitFor({ state: 'attached' });
  expect(await page.locator('svg g path').count()).toBe(2);
});

it('a 1-day task can be dragged to a new day at Month zoom', async () => {
  const page = await smoke.pageAs('admin');
  await openTimeline(page);
  const patched = waitFor(page, 'PATCH', `/tasks/${t5.id}`);
  await dragBy(page, bar(page, t5), 24);
  await patched;
  expect(await dates(t5)).toEqual(['2026-11-19', '2026-11-19']);
});

it('the undated task is listed under Not scheduled and has no bar', async () => {
  const page = await smoke.pageAs('admin');
  await openTimeline(page);
  await page.getByRole('region', { name: 'Not scheduled' }).getByText('Undated cleanup').waitFor();
  expect(await bar(page, t4).count()).toBe(0);
});

it('zoom switch keeps today in view', async () => {
  const page = await smoke.pageAs('admin');
  await openTimeline(page);
  for (const name of ['Week', 'Quarter', 'Month']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(100);
    const inView = await page.evaluate(() => {
      const box = document.querySelector('[data-timeline-scroll]').getBoundingClientRect();
      const x = document.querySelector('[data-today-line]').getBoundingClientRect().left;
      return x >= box.left && x <= box.right;
    });
    expect(inView).toBe(true);
  }
});

it('a view-only member sees the bars but cannot drag them', async () => {
  const page = await smoke.pageAs('viewer');
  await openTimeline(page);
  await bar(page, t2).waitFor();
  expect(await page.locator('[data-handle]').count()).toBe(0);
  const before = await dates(t2);
  await dragBy(page, bar(page, t2), 36);
  await page.waitForTimeout(300);
  expect(await dates(t2)).toEqual(before);
});

it('under 768px the timeline scrolls and bars cannot be dragged', async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 375, height: 800 } });
  await openTimeline(page);
  await bar(page, t3).waitFor();
  const scrolls = await page.evaluate(() => {
    const el = document.querySelector('[data-timeline-scroll]');
    return el.scrollWidth > el.clientWidth;
  });
  expect(scrolls).toBe(true);
  const todayShown = await page.evaluate(() => {
    const box = document.querySelector('[data-timeline-scroll]').getBoundingClientRect();
    const x = document.querySelector('[data-today-line]').getBoundingClientRect().left;
    return x >= box.left + 112 && x <= box.right;
  });
  expect(todayShown).toBe(true);
  expect(await page.locator('[data-handle]').count()).toBe(0);
  const before = await dates(t3);
  await bar(page, t3).scrollIntoViewIfNeeded();
  await dragBy(page, bar(page, t3), 36);
  await page.waitForTimeout(300);
  expect(await dates(t3)).toEqual(before);
});
