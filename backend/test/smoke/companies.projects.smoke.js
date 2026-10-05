const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 14.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a project for a client: owned by an internal department, for one of the client\'s', async () => {
  const admin = await makeAdmin();
  const sd = await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  const acmeHr = await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/projects/new');
  await page.locator('#company-picker').selectOption(String(acme.id));
  // The name input is the form's first text input (its label isn't tied to it).
  await page.locator('form input').first().fill('Rollout');
  const owner = page.locator('select').filter({ hasText: 'Service Desk' }).first();
  expect(await owner.locator('option').allTextContents()).not.toContain('Acme HR');
  await owner.selectOption(String(sd.id));
  const forDept = page.locator('select').filter({ hasText: 'Acme HR' }).first();
  expect(await forDept.locator('option').allTextContents()).not.toContain('Service Desk');
  await forDept.selectOption(String(acmeHr.id));
  await page.getByRole('button', { name: /Create project/i }).click();
  await page.waitForURL(/\/projects\/\d+/);
  const project = await models.Project.findOne({ where: { name: 'Rollout' } });
  expect([project.companyId, project.ownerDepartmentId, project.forDepartmentId]).toEqual([acme.id, sd.id, acmeHr.id]);
});
