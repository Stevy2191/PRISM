const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, makeManager,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Sub-project 6, task 11: the template editor in Settings and the look A New
// project screen (Start from, form, live preview), plus Save as template.

const shown = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();
const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let template;
let admin;
// One sign-in for the file: the login endpoint is rate limited.
const adminPage = async () => { admin = admin || await smoke.pageAs('admin'); return admin; };
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  template = expectOk(await w.admin.agent.post(`${API}/project-templates`).send({
    name: 'Network refresh',
    description: 'Switches and Wi-Fi',
    hourBudgetMinutes: 600,
    tags: ['network'],
    phases: [{ id: 'p1', name: 'Plan' }, { id: 'p2', name: 'Install' }],
    tasks: [
      { id: 't1', phaseId: 'p1', title: 'Walk the site', startDay: 1, lengthDays: 2, estimateMinutes: 240 },
      { id: 't2', phaseId: 'p1', title: 'Draw the plan', startDay: 3, lengthDays: 3, estimateMinutes: 360 },
      { id: 't3', phaseId: 'p2', title: 'Rack the switches', startDay: 6, lengthDays: 4, estimateMinutes: 120 },
    ],
    dependencies: [{ predecessorId: 't1', successorId: 't2' }],
  }), 201).template;
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('edit a template: add a task under a phase, set Waits on, save', async () => {
  const page = await adminPage();
  await page.goto(`/settings/project-templates/${template.id}`);
  await page.getByLabel('Template name').filter({ visible: true }).first().waitFor();
  const input = page.getByLabel('Add a task to Install').filter({ visible: true }).first();
  await input.fill('Label the cables');
  await input.press('Enter');
  await shown(page, 'Label the cables').or(page.locator('input[value="Label the cables"]').first()).waitFor();
  await page.getByLabel('Waits on for Label the cables').filter({ visible: true }).first().selectOption({ label: 'Rack the switches' });
  const saved = waitFor(page, 'PUT', `/project-templates/${template.id}`);
  await page.getByRole('button', { name: 'Save template' }).filter({ visible: true }).first().click();
  expect((await saved).ok()).toBe(true);
  const got = expectOk(await w.admin.agent.get(`${API}/project-templates/${template.id}`)).template;
  const added = got.tasks.find((t) => t.title === 'Label the cables');
  const rack = got.tasks.find((t) => t.title === 'Rack the switches');
  expect(added.phaseId).toBe(got.phases.find((p) => p.name === 'Install').id);
  expect(got.dependencies).toEqual(expect.arrayContaining([{ predecessorId: rack.id, successorId: added.id }]));
  expect(got.dependencies).toHaveLength(2);
});

const startFrom = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).filter({ visible: true }).first().click();
const previewDates = async (page) => page.getByRole('complementary', { name: /What the template will create/ }).innerText();

it('New project from a template: changing finish date updates the preview dates', async () => {
  const page = await adminPage();
  await page.goto('/projects/new');
  await startFrom(page, 'Network refresh');
  await page.getByLabel('Start date').fill('2026-11-16');
  await page.getByText('Install').filter({ visible: true }).first().waitFor();
  const finish = page.getByLabel('Finish date');
  await page.waitForFunction(() => Boolean(document.querySelector('#finish-date')?.value));
  const before = await previewDates(page);
  expect(before).toContain('Nov 16');
  const changed = waitFor(page, 'GET', '/preview?');
  await finish.fill('2026-12-20');
  await changed;
  await page.waitForFunction((old) => document.querySelector('aside')?.innerText !== old, before);
  const after = await previewDates(page);
  expect(after).not.toBe(before);
  expect(after).toContain('Dec');
});

it('Create project lands on the new project with its phases', async () => {
  const page = await adminPage();
  await page.goto('/projects/new');
  await startFrom(page, 'Network refresh');
  await page.getByLabel('Start date').fill('2026-11-16');
  await page.getByLabel('Project name').fill('Northgate network');
  await page.getByLabel('Owned by').selectOption({ label: 'Service Desk' });
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/projects\/\d+$/);
  for (const name of ['Plan', 'Install']) {
    await page.getByRole('region', { name, exact: true }).filter({ visible: true }).first().waitFor();
  }
  await shown(page, 'Walk the site').waitFor();
});

it('Copy an existing project lists only projects I can see', async () => {
  const a = w.admin.agent;
  await makeProject(a, { name: 'Visible job', ownerDepartmentId: w.deptA.id });
  await makeProject(a, { name: 'Hidden job', ownerDepartmentId: w.deptB.id });
  await makeManager('tina', w.deptA.id);
  const page = await smoke.pageAs('tina');
  await page.goto('/projects/new');
  await startFrom(page, 'Copy an existing project');
  const pick = page.getByLabel('Project to copy');
  await pick.locator('option', { hasText: 'Visible job' }).waitFor({ state: 'attached' });
  const options = await pick.locator('option').allInnerTexts();
  expect(options.some((o) => o.includes('Visible job'))).toBe(true);
  expect(options.some((o) => o.includes('Hidden job'))).toBe(false);
});

it('Save as template from the project menu opens the new template', async () => {
  const a = w.admin.agent;
  const project = await makeProject(a, { name: 'Clinic move', ownerDepartmentId: w.deptA.id });
  await makeTask(a, project.id, { title: 'Pack boxes' });
  const page = await adminPage();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'More actions' }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: 'Save as template' }).click();
  await page.getByLabel('Template name').fill('Clinic move template');
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForURL(/\/settings\/project-templates\/\d+$/);
  await page.locator('input[value="Pack boxes"]').first().waitFor();
  expect(await page.getByLabel('Template name').inputValue()).toBe('Clinic move template');
});

it('removing the template tags on New project makes a project with no tags', async () => {
  const page = await adminPage();
  await page.goto('/projects/new');
  await startFrom(page, 'Network refresh');
  await page.getByText('network', { exact: true }).filter({ visible: true }).first().waitFor();
  await page.getByLabel('Project name').fill('Untagged job');
  await page.getByLabel('Owned by department').selectOption({ label: 'Service Desk' });
  await page.locator('form span:has-text("network") button').first().click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/projects\/\d+$/);
  const made = expectOk(await w.admin.agent.get(`${API}/projects`).query({ search: 'Untagged job' })).projects[0];
  expect(made.tags || []).toEqual([]);
});

it('a template that fails to load shows only the error, with no Save', async () => {
  const page = await adminPage();
  await page.goto('/settings/project-templates/999999');
  await page.getByRole('alert').filter({ visible: true }).first().waitFor();
  expect(await page.getByRole('button', { name: 'Save template' }).count()).toBe(0);
  expect(await page.getByLabel('Template name').count()).toBe(0);
});

it('the preview says when the plan finishes and why it overshoots', async () => {
  const page = await adminPage();
  await page.goto('/projects/new');
  await startFrom(page, 'Network refresh');
  await page.getByLabel('Start date').fill('2026-11-16');
  await page.getByTestId('plan-finish').waitFor();
  const first = await page.getByTestId('plan-finish').innerText();
  expect(first).toMatch(/Finishes \w{3}, \w{3} \d+/);
  await page.getByLabel('Finish date').fill('2026-11-20');
  await page.waitForFunction(() => /because/.test(document.querySelector('[data-testid="plan-finish"]')?.innerText || ''));
  expect(await page.getByTestId('plan-finish').innerText()).toContain('waits on');
});

it('the editor adds a subtask under a task and warns before leaving with unsaved changes', async () => {
  const page = await adminPage();
  await page.goto(`/settings/project-templates/${template.id}`);
  await page.getByLabel('Template name').filter({ visible: true }).first().waitFor();
  await page.getByRole('button', { name: 'Add a subtask to Walk the site' }).click();
  const input = page.getByLabel('Name the subtask of Walk the site');
  await input.fill('Photograph closets');
  await input.press('Enter');
  const dialogs = [];
  const onDialog = (d) => { dialogs.push(d.message()); d.dismiss(); };
  page.on('dialog', onDialog);
  await page.getByRole('link', { name: 'All templates' }).click();
  expect(dialogs[0]).toMatch(/unsaved changes/);
  expect(page.url()).toContain(`/settings/project-templates/${template.id}`);
  page.off('dialog', onDialog);
  const saved = waitFor(page, 'PUT', `/project-templates/${template.id}`);
  await page.getByRole('button', { name: 'Save template' }).click();
  await saved;
  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  const got = expectOk(await w.admin.agent.get(`${API}/project-templates/${template.id}`)).template;
  const sub = got.tasks.find((t) => t.title === 'Photograph closets');
  expect(sub.parentId).toBe(got.tasks.find((t) => t.title === 'Walk the site').id);
});
