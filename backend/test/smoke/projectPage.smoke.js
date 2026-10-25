const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Sub-project 6, task 5: the look A project page. Phases on the Tasks tab,
// quick-add in a phase, the filter pills and the Costs tab.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('tab', { name }).filter({ visible: true }).first().click();
const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let project;
let build;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  project = await makeProject(a, { name: 'Clinic refresh', ownerDepartmentId: w.deptA.id });
  build = expectOk(await a.post(`${API}/projects/${project.id}/phases`).send({ name: 'Build' }), 201).phase;
  expectOk(await a.post(`${API}/projects/${project.id}/phases`).send({ name: 'Rollout' }), 201);
  const placed = await makeTask(a, project.id, { title: 'Pull cable' });
  expectOk(await a.patch(`${API}/projects/${project.id}/tasks/${placed.id}`).send({ phaseId: build.id }));
  await makeTask(a, project.id, { title: 'Loose task' });
  expectOk(await a.post(`${API}/projects/${project.id}/expenses`).send({ description: 'Seeded expense', amount: 12 }), 201);
  expectOk(await a.post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Seeded material', quantity: 1, unitCost: 3 }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the summary row, phases and the filter pills show', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Clinic refresh').waitFor();
  await page.getByText('Tasks done').filter({ visible: true }).first().waitFor();
  for (const name of ['Build', 'Rollout', 'No phase']) {
    await page.getByRole('region', { name, exact: true }).filter({ visible: true }).first().waitFor();
  }
  for (const pill of ['All', 'Mine', 'Waiting', 'Overdue', 'Unassigned', 'Done']) {
    await page.getByRole('button', { name: pill, exact: true }).filter({ visible: true }).first().waitFor();
  }
  await shown(page, 'Pull cable').waitFor();
});

it('quick-add in a phase creates a task in that phase', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  const input = page.getByLabel('Add a task to Rollout').filter({ visible: true }).first();
  await input.fill('Cut over the switch');
  const created = waitFor(page, 'POST', `/projects/${project.id}/tasks`);
  await input.press('Enter');
  await created;
  await shown(page, 'Cut over the switch').waitFor();
  const { tasks } = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`));
  const rollout = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/phases`)).phases.find((p) => p.name === 'Rollout');
  expect(tasks.find((t) => t.title === 'Cut over the switch').phaseId).toBe(rollout.id);
});

it('collapsing a phase hides its rows', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Pull cable').waitFor();
  await page.getByRole('button', { name: 'Collapse Build' }).filter({ visible: true }).first().click();
  await shown(page, 'Pull cable').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Expand Build' }).filter({ visible: true }).first().click();
  await shown(page, 'Pull cable').waitFor();
});

it('the Unassigned pill keeps only unassigned tasks', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Loose task').waitFor();
  await page.getByRole('button', { name: 'Mine', exact: true }).filter({ visible: true }).first().click();
  await shown(page, 'Loose task').waitFor({ state: 'hidden' });
});

it('Costs tab shows expenses and materials', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Clinic refresh').waitFor();
  await tab(page, /^Costs/);
  await shown(page, 'Seeded expense').waitFor();
  await shown(page, 'Seeded material').waitFor();
});
