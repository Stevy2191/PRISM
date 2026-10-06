const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, makeSubtask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3a guard for the project page: every tab renders its seeded content.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();

let smoke;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  const w = await makeWorld();
  const a = w.admin.agent;
  project = await makeProject(a, { name: 'Office move', ownerDepartmentId: w.deptA.id });
  const task = await makeTask(a, project.id, { title: 'Seeded project task' });
  await makeSubtask(a, project.id, task.id, { title: 'Seeded subtask' });
  expectOk(await a.post(`${API}/projects/${project.id}/time-entries`).send({
    startTime: '2026-03-10T13:00:00Z', endTime: '2026-03-10T14:00:00Z', entryDate: '2026-03-10', note: 'Seeded project time',
  }), 201);
  expectOk(await a.post(`${API}/projects/${project.id}/expenses`).send({ description: 'Seeded expense', amount: 12 }), 201);
  expectOk(await a.post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Seeded material', quantity: 1, unitCost: 3 }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the header and the tasks tab render', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Office move').waitFor();
  await shown(page, 'Seeded project task').waitFor();
});

it('every tab opens and shows its content', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Office move').waitFor();
  await tab(page, /^Time Entries/);
  await shown(page, 'Seeded project time').waitFor();
  await tab(page, /^Expenses/);
  await shown(page, 'Seeded expense').waitFor();
  await tab(page, /^Materials/);
  await shown(page, 'Seeded material').waitFor();
  await tab(page, /^People/);
  await shown(page, '+ Add person').waitFor();
  await tab(page, /^Files/);
  await tab(page, /^Activity/);
});

it('a task opens its detail with its subtask', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Seeded project task').click();
  await shown(page, 'Seeded subtask').waitFor();
});
