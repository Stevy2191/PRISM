const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Sub-project 6, task 14: the project page on a phone (375 x 812).

const VIEW = { viewport: { width: 375, height: 812 } };
const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
let project;
let build;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  project = await makeProject(a, { name: 'Phone project', ownerDepartmentId: w.deptA.id });
  build = expectOk(await a.post(`${API}/projects/${project.id}/phases`).send({ name: 'Build' }), 201).phase;
  expectOk(await a.post(`${API}/projects/${project.id}/phases`).send({ name: 'Rollout' }), 201);
  const mine = await makeTask(a, project.id, { title: 'Pull cable', assigneeId: w.admin.user.id });
  expectOk(await a.patch(`${API}/projects/${project.id}/tasks/${mine.id}`).send({ phaseId: build.id }));
  await makeTask(a, project.id, { title: 'Someone elses task' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

async function open() {
  const page = await smoke.pageAs('admin', undefined, VIEW);
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Pull cable').waitFor();
  return page;
}

it('no horizontal page scroll at 375px', async () => {
  const page = await open();
  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.win);
  // Two summary tiles on a phone; Mine / All / Waiting.
  expect(await page.getByText('Next milestone').filter({ visible: true }).count()).toBe(0);
  for (const pill of ['Mine', 'All', 'Waiting']) await page.getByRole('button', { name: pill, exact: true }).waitFor();
  await shown(page, 'Someone elses task').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await shown(page, 'Someone elses task').waitFor();
});

it('timer button is at least 44px and starts a timer', async () => {
  const page = await open();
  const btn = page.getByRole('button', { name: /^Start timer on/ }).first();
  const box = await btn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  await page.getByRole('button', { name: /^Stop timer on/ }).first().waitFor();
});

it('Log time in the dock opens the time form', async () => {
  const page = await open();
  await page.getByRole('button', { name: 'Log time', exact: true }).click();
  await page.getByRole('dialog').waitFor();
});

it('Add task in the dock adds to the first open phase', async () => {
  const page = await open();
  // The dock's button is the last one on the page; the header has its own.
  await page.getByRole('button', { name: 'Add task', exact: true }).last().click();
  await page.getByLabel('New task title').fill('Dock task');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/projects/${project.id}/tasks`));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await created;
  const { tasks } = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`));
  expect(tasks.find((t) => t.title === 'Dock task').phaseId).toBe(build.id);
});

it('the header Add task opens the same input', async () => {
  const page = await open();
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await page.getByLabel('New task title').waitFor();
});
