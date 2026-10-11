const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: one server timer. It starts from a project page, pauses and
// resumes, and shows in the top bar on any page.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

let smoke;
let w;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  project = await makeProject(w.admin.agent, { name: 'Timer project', ownerDepartmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('starts, pauses, resumes and shows in the top bar', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await button(page, 'Start timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/start'));
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ type: 'project', id: project.id, state: 'running' }));
  await button(page, 'Pause timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/pause'));
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer.state).toBe('paused');
  await button(page, 'Resume timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/resume'));
  await page.goto('/tickets');
  await page.getByRole('link', { name: /Timer project/ }).filter({ visible: true }).first().waitFor();
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});
