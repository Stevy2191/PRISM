const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Sub-project 6, task 9: the look A projects list with its attention tiles, and
// the budget editor in the project's Time tab.

const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let over;
let fine;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  over = await makeProject(a, { name: 'Overspent rollout', ownerDepartmentId: w.deptA.id, assignedToUserId: w.admin.user.id });
  fine = await makeProject(a, { name: 'Calm install', ownerDepartmentId: w.deptA.id });
  expectOk(await a.patch(`${API}/projects/${over.id}`).send({ hourBudgetMinutes: 60 }));
  expectOk(await a.post(`${API}/projects/${over.id}/time-entries`).send({ durationMinutes: 90 }), 201);
  expectOk(await a.post(`${API}/projects/${fine.id}/time-entries`).send({ durationMinutes: 30 }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('clicking the over-budget tile filters the list', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/projects');
  await page.getByText('Calm install').first().waitFor();
  await page.getByText('Overspent rollout').first().waitFor();
  const tile = page.getByRole('button', { name: /project over its hour budget/ });
  await tile.waitFor();
  expect(await tile.innerText()).toContain('1');
  await tile.click();
  await page.getByText('Calm install').first().waitFor({ state: 'hidden' });
  await page.getByText('Overspent rollout').first().waitFor();
  expect(await tile.getAttribute('aria-pressed')).toBe('true');
  await tile.click();
  await page.getByText('Calm install').first().waitFor();
});

it('the I lead pill keeps the projects I lead', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/projects');
  await page.getByText('Calm install').first().waitFor();
  await page.getByRole('button', { name: 'I lead', exact: true }).click();
  await page.getByText('Calm install').first().waitFor({ state: 'hidden' });
  await page.getByText('Overspent rollout').first().waitFor();
});

it('budget editor saves and the meter turns red over 100%', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${fine.id}`);
  await page.getByRole('tab', { name: /^Time(?!line)/ }).filter({ visible: true }).first().click();
  const meter = page.getByRole('meter', { name: 'Hours used' });
  await page.getByLabel('Project budget').fill('1');
  const saved = waitFor(page, 'PATCH', `/projects/${fine.id}`);
  await page.getByRole('button', { name: 'Save budget' }).click();
  await saved;
  await meter.waitFor();
  expect(await meter.getAttribute('data-level')).toBe('ok');
  expect(expectOk(await w.admin.agent.get(`${API}/projects/${fine.id}`)).project.hourBudgetMinutes).toBe(60);
  // 30 of 60 minutes; shrink the budget to 15 minutes and the same hours are over it.
  await page.getByLabel('Project budget').fill('0.25');
  const again = waitFor(page, 'PATCH', `/projects/${fine.id}`);
  await page.getByRole('button', { name: 'Save budget' }).click();
  await again;
  await page.locator('[role=meter][data-level=over]').first().waitFor();
  await page.getByText(/People can still log time/).first().waitFor();
  expect(expectOk(await w.admin.agent.get(`${API}/projects/${fine.id}`)).project.hourBudgetMinutes).toBe(15);
});
